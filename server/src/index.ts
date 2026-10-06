// Pixel Rumble API. Thin by design: BetterAuth at /api/auth/*, session info
// at /api/me, per-user ladder sync at /api/sync, and the consensus ranking
// at /api/global computed by the client-identical engine.js.
import { Hono } from "hono";
import { makeAuth, type Env } from "./auth";
import { registerGlobalRoutes, registerSyncRoutes } from "./sync";

type AppEnv = { Bindings: Env };

const app = new Hono<AppEnv>();

// One auth instance per D1 binding (stable within an isolate).
let authFor: D1Database | null = null;
let authCache: ReturnType<typeof makeAuth> | null = null;
function authOf(env: Env) {
  if (!authCache || authFor !== env.DB) {
    authCache = makeAuth(env);
    authFor = env.DB;
  }
  return authCache;
}

app.get("/api/health", async (c) => {
  const started = Date.now();
  try {
    const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return c.json({ ok: row?.ok === 1, db: "d1", ms: Date.now() - started });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

app.on(["POST", "GET"], "/api/auth/*", (c) => authOf(c.env).handler(c.req.raw));

app.get("/api/me", async (c) => {
  const session = await authOf(c.env).api.getSession({ headers: c.req.raw.headers });
  return c.json({ user: session ? { id: session.user.id, name: session.user.name, email: session.user.email } : null });
});

registerSyncRoutes(app, authOf);
registerGlobalRoutes(app);

export default app;
