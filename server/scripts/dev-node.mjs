// Node dev harness for the Pixel Rumble API — `npm run dev:node`.
//
// wrangler dev is the canonical loop, but it has been unable to start on
// some machines (spawn EBADF inside its esbuild/workerd bootstrap). This
// harness reproduces the parts the app needs, with zero extra dependencies:
//
//   - bundles src/index.ts with esbuild's async API, the same bundler
//     wrangler uses. Conditions match wrangler's selection (workerd/browser
//     variants of better-auth's packages — they behave differently from the
//     node variants), while node: builtins stay external because the harness
//     runs on Node, which provides them,
//   - backs the D1 binding with node:sqlite, implementing the slice of the
//     D1 API that Hono routes and the Drizzle adapter use, and applies the
//     SQL migrations from server/migrations on boot,
//   - serves the repo root statically (honouring .assetsignore) and forwards
//     /api/* to the Worker's fetch handler.
//
// State persists at /tmp/pr-node-d1/ (delete it to start clean). Sessions,
// sign-up/sign-in, sync and the global ranking all run for real; anything
// workerd-specific (streams, D1 minutiae) may differ from production — the
// deployed Worker still gets its final verification through wrangler.
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const rootDir = dirname(serverDir);
const PORT = Number(process.env.PORT || 8791);
const STATE_DIR = process.env.D1_STATE || "/tmp/pr-node-d1";

// ---------- bundle the worker ----------

const outfile = join(serverDir, ".tmp", "node-worker.mjs");
await build({
  entryPoints: [join(serverDir, "src", "index.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2023",
  conditions: ["workerd", "browser"],
  external: ["node:*"],
  logLevel: "warning",
});
const worker = (await import(`file://${outfile}`)).default;

// ---------- D1 over node:sqlite ----------

import { mkdirSync } from "node:fs";
mkdirSync(STATE_DIR, { recursive: true });
const sqlite = new DatabaseSync(join(STATE_DIR, "state.db"));

function applyMigrations() {
  sqlite.exec("CREATE TABLE IF NOT EXISTS d1_migrations (name TEXT PRIMARY KEY, applied_at INTEGER)");
  const applied = new Set(sqlite.prepare("SELECT name FROM d1_migrations").all().map((r) => r.name));
  const dir = join(serverDir, "migrations");
  const files = readFileSync(join(dir, "meta", "_journal.json"), "utf8");
  const journal = JSON.parse(files);
  for (const entry of journal.entries) {
    if (applied.has(entry.tag)) continue;
    const sql = readFileSync(join(dir, `${entry.tag}.sql`), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
    sqlite.prepare("INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)").run(entry.tag, Date.now());
    console.log(`[dev-node] migration applied: ${entry.tag}`);
  }
}
applyMigrations();

// The D1 slice used by the API: chained statements plus batch/exec. Values
// convert the way D1 accepts them (booleans become integers, undefined
// becomes null).
class D1Statement {
  constructor(sql, params) {
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new D1Statement(this.sql, params);
  }
  normalize(value) {
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value === undefined) return null;
    return value;
  }
  _run() {
    return sqlite.prepare(this.sql).run(...this.params.map((p) => this.normalize(p)));
  }
  async first() {
    const row = sqlite.prepare(this.sql).get(...this.params.map((p) => this.normalize(p)));
    return row === undefined ? null : row;
  }
  async all() {
    return { results: sqlite.prepare(this.sql).all(...this.params.map((p) => this.normalize(p))) };
  }
  async run() {
    const r = this._run();
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  // D1's raw() yields rows as arrays in column order (drizzle's values()
  // path maps them positionally), not objects like all().
  async raw() {
    if (process.env.D1_DEBUG && this.sql.includes("insert")) {
      console.log("[d1-debug]", this.sql, JSON.stringify(this.params));
    }
    const rows = sqlite.prepare(this.sql).all(...this.params.map((p) => this.normalize(p)));
    return rows.map((row) => Object.values(row));
  }
}

const d1 = {
  prepare: (sql) => new D1Statement(sql, []),
  // D1 batch results are {results: [...]} per statement — drizzle's batch
  // mapping reads that shape for selects and RETURNING alike.
  async batch(statements) {
    const out = [];
    sqlite.exec("BEGIN");
    try {
      for (const stmt of statements) {
        const rows = sqlite.prepare(stmt.sql).all(...stmt.params.map((p) => stmt.normalize(p)));
        out.push({ results: rows });
      }
      sqlite.exec("COMMIT");
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
    return out;
  },
  async exec(sql) {
    sqlite.exec(sql);
    return { count: 0, duration: 0 };
  },
};

// ---------- env ----------

const devVars = {};
const devVarsPath = join(serverDir, ".dev.vars");
if (existsSync(devVarsPath)) {
  for (const line of readFileSync(devVarsPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) devVars[m[1]] = m[2];
  }
}

const env = {
  DB: d1,
  BETTER_AUTH_SECRET: devVars.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: `http://localhost:${PORT}`,
};
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
};

// ---------- static assets (repo root, .assetsignore honoured) ----------

const ignored = readFileSync(join(rootDir, ".assetsignore"), "utf8")
  .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

function isIgnored(path) {
  const clean = path.replace(/^\/+/, "");
  return ignored.some((pat) => clean === pat || clean.startsWith(pat + "/"));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function serveStatic(req, res, pathname) {
  if (isIgnored(pathname)) {
    res.writeHead(404).end("not found");
    return true;
  }
  let file = join(rootDir, pathname);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    const idx = join(file, "index.html");
    if (!existsSync(idx)) return false;
    file = idx;
  }
  const body = readFileSync(file);
  res.writeHead(200, {
    "content-type": MIME[extname(file)] || "application/octet-stream",
    "content-length": body.length,
    "cache-control": "no-cache",
  });
  res.end(body);
  return true;
}

// ---------- server ----------

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, {
        method: req.method,
        headers: Object.entries(req.headers).flatMap(([k, v]) =>
          Array.isArray(v) ? v.map((vv) => [k, vv]) : [[k, v]]
        ),
        body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
        redirect: "manual",
      });
      const out = await worker.fetch(request, env, ctx);
      res.writeHead(out.status, Array.from(out.headers));
      if (out.body) {
        for await (const chunk of out.body) res.write(chunk);
      }
      res.end();
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) {
      // Directory-style URLs: try the index, else redirect like assets do.
      if (serveStatic(req, res, pathname)) return;
      res.writeHead(307, { location: pathname.replace(/\/+$/, "") || "/" }).end();
      return;
    }
    if (serveStatic(req, res, pathname)) return;
    res.writeHead(404).end("not found");
  } catch (e) {
    console.error("[dev-node]", e);
    res.writeHead(500).end(String(e && e.stack || e));
  }
});

server.listen(PORT, () => {
  console.log(`[dev-node] http://localhost:${PORT}  (app + /api/*, D1 at ${STATE_DIR})`);
});
