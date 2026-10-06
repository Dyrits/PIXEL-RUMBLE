// Ladder sync and the global ranking. Sync keeps one store document per user
// (the SPA's whole localStorage payload) with a monotonic revision for
// optimistic concurrency: a push whose base revision no longer matches the
// server's is rejected with the current state so the client can merge and
// retry. The global ranking replays every user's battles through the same
// DOM-free engine.js the client uses, so one Elo model computes both the
// personal and the consensus ladder.
import type { Hono } from "hono";
import engine from "../../engine.js";
import { makeAuth, type Env } from "./auth";

// D1 rows hold text columns; a store near 1 MiB would be at the edge of
// D1's row size, so pushes are capped well below it.
const MAX_STORE_CHARS = 900_000;

type SyncApp = Hono<{ Bindings: Env }>;
type AuthOf = (env: Env) => ReturnType<typeof makeAuth>;

interface StoreDoc {
  version: number;
  ladders: Record<string, { battles?: unknown[] }>;
}

interface StateRow {
  rev: number;
  store: string;
}

function parseStoreDoc(raw: string): StoreDoc | null {
  if (raw.length > MAX_STORE_CHARS) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  return engine.validStore(doc) ? (doc as StoreDoc) : null;
}

export function registerSyncRoutes(app: SyncApp, authOf: AuthOf) {
  const loadState = (db: D1Database, userId: string) =>
    db.prepare("SELECT rev, store FROM ladder_state WHERE user_id = ?")
      .bind(userId).first<StateRow>();

  // The 409 body the client's push() knows how to merge: the current
  // revision plus the store that beat the push.
  const conflict = (row: StateRow | null) =>
    row
      ? { conflict: true, rev: row.rev, store: JSON.parse(row.store) }
      : { conflict: true, rev: 0, store: null };

  // Pull: the caller's current revision and store, or rev 0 when nothing
  // has been pushed yet.
  app.get("/api/sync", async (c) => {
    const session = await authOf(c.env).api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const row = await loadState(c.env.DB, session.user.id);
    return c.json({ rev: row ? row.rev : 0, store: row ? JSON.parse(row.store) : null });
  });

  // Push: accepted only when baseRev matches the server's revision, so two
  // devices cannot silently overwrite each other's duels.
  app.put("/api/sync", async (c) => {
    const session = await authOf(c.env).api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const userId = session.user.id;

    let body: { baseRev?: unknown; store?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const baseRev = Number(body.baseRev);
    const raw = typeof body.store === "string" ? body.store : JSON.stringify(body.store);
    if (!Number.isInteger(baseRev) || baseRev < 0 || !parseStoreDoc(raw)) {
      return c.json({ error: "invalid store" }, 400);
    }

    const current = await loadState(c.env.DB, userId);

    if (current) {
      if (baseRev !== current.rev) {
        return c.json(conflict(current), 409);
      }
      const res = await c.env.DB.prepare(
        "UPDATE ladder_state SET rev = rev + 1, store = ?, updated_at = ? WHERE user_id = ? AND rev = ?"
      ).bind(raw, Date.now(), userId, current.rev).run();
      // changes !== 1 means a push landed between the SELECT and the UPDATE.
      if ((res.meta as { changes?: number }).changes !== 1) {
        return c.json(conflict(await loadState(c.env.DB, userId)), 409);
      }
      return c.json({ rev: current.rev + 1 });
    }

    if (baseRev !== 0) {
      return c.json(conflict(null), 409);
    }
    try {
      await c.env.DB.prepare(
        "INSERT INTO ladder_state (user_id, rev, store, updated_at) VALUES (?, 1, ?, ?)"
      ).bind(userId, raw, Date.now()).run();
    } catch {
      // Two first pushes raced; the insert lost — report the winner.
      return c.json(conflict(await loadState(c.env.DB, userId)), 409);
    }
    return c.json({ rev: 1 });
  });
}

// ---------- global ranking ----------

// Per-isolate cache keyed by a signature of the underlying rows, so a burst
// of Global-tab views costs one replay per changed state, not per request.
let globalCache: { sig: string; at: number; body: unknown } | null = null;
const GLOBAL_TTL_MS = 60_000;

export async function globalRanking(db: D1Database) {
  const sigRow = await db.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(rev), 0) AS s, COALESCE(MAX(updated_at), 0) AS m FROM ladder_state"
  ).first<{ n: number; s: number; m: number }>();
  const sig = `${sigRow?.n ?? 0}:${sigRow?.s ?? 0}:${sigRow?.m ?? 0}`;
  const now = Date.now();
  if (globalCache && globalCache.sig === sig && now - globalCache.at < GLOBAL_TTL_MS) {
    return globalCache.body;
  }

  const { results } = await db.prepare(
    "SELECT store FROM ladder_state"
  ).all<{ store: string }>();

  const battles: unknown[] = [];
  let raters = 0;
  for (const row of results || []) {
    const doc = parseStoreDoc(row.store);
    if (!doc) continue;
    let contributed = 0;
    for (const ladder of Object.values(doc.ladders)) {
      if (Array.isArray(ladder.battles)) {
        contributed += ladder.battles.length;
        battles.push(...ladder.battles);
      }
    }
    // A synced store with no duels hasn't ranked anything; counting it as a
    // rater would say "0 duels from 1 player".
    if (contributed > 0) raters += 1;
  }

  const { recs } = engine.replayBattles(battles);
  const ranked = Object.entries(recs)
    .filter(([, rec]) => rec.w + rec.l > 0)
    .map(([id, rec]) => ({ id, r: rec.r, w: rec.w, l: rec.l }))
    .sort((x, y) => y.r - x.r || x.w - y.w || (x.id < y.id ? -1 : 1));

  const body = {
    generatedAt: new Date(now).toISOString(),
    raters,
    battles: battles.length,
    ranked,
  };
  globalCache = { sig, at: now, body };
  return body;
}

export function registerGlobalRoutes(app: SyncApp) {
  app.get("/api/global", async (c) => c.json(await globalRanking(c.env.DB)));
}
