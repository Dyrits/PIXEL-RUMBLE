# Work in progress

## Design pass + feedback fixes delivered (CHG-0009, CHG-0010) — awaiting acceptance

Design pass (CHG-0009): auth dialog rebuilt (fitted panel, × close, one full-width primary, text-link mode switch), ≤560px header as a named-row grid, stats charts at exact device resolution with pixel-ellipsized labels, stats tile dividers via grid gap, `?v=` asset tags in `index.html`. User feedback round (CHG-0010): stale sign-up mode across dialog opens made "Sign in" demand a name (fixed via `setMode()` reset in `openModal`); phones stacked the duel pair full-size so the second card sat below the fold (≤610px now side-by-side compact — both cards + VS + haven't-played row fit 390×844); sign-in dialog compacts on phones. Asset tags now `?v=2026-10-06b` — bump on every asset edit. **Note:** a reboot wiped `/tmp/pr-d1-state`, taking the earlier local accounts; test user re-created: dylan@test.dev / pixel-rumble-1. Re-run `npm run db:local` in `server/` if tables vanish again.

## Multi-user milestone (CHG-0006 agreement, baseline revision 55b7ef1)

**Agreed architecture:** Hono API on Cloudflare Workers + D1 in front of the existing SPA (served as Worker assets, offline-first kept); BetterAuth with D1 adapter for accounts; global ranking = shared Elo computed server-side by the existing DOM-free `engine.js`; personal rankings = per-user ladders synced through the API. Effect declined (framework weight > domain); Marko declined for now (rewrite; may consume the same API later as a front-end project — vetted path: marko-js/examples vite-cloudflare-marko-5).

**Batch 1 delivered (CHG-0007):** worker skeleton — app served as assets with `.assetsignore` guarding internals, `GET /api/health` proving D1, typecheck clean. Verified against `wrangler dev` locally; `server` dev server may still be running on port 8790.

**Batch 2 delivered (CHG-0008):** BetterAuth accounts — Drizzle-on-D1 adapter (scoped to auth), CLI-generated schema + wrangler-applied migrations, `/api/auth/*` + `/api/me`, zero-dep `auth.js` modal/header UI in the SPA. Verified by curl e2e and browser e2e (sign-up → chip → reload persistence → sign-out). Dev-server reload loop fixed via `--persist-to` out-of-tree state (baked into `npm run dev`). Local dev state: `/tmp/pr-d1-state` (wiped on reboot — re-run `npm run db:local` if tables vanish). Test users exist in local D1: dylan@test.dev, tester@test.dev.

**Next batches (proposed order):**
1. Ladder sync: push battles/ladder state per user, pull on sign-in; merge with localStorage.
2. Global ranking: server replays all users' battles through `engine.js`, cached/materialized; "Global" view in the SPA.
3. Deploy: `wrangler login`, `wrangler d1 create pixel-rumble` (paste id into wrangler.jsonc), remote migrations + secret, `npm run deploy`, smoke test.

**Open questions:** none blocking batch 2. Per-user weighting caps on the global ladder deferred until spam is observed.

## Awaiting acceptance: duel-screen changes (CHG-0002 – CHG-0005)

All batches implemented, verified, and delivered; user review pending. Freshest verification origin: http://localhost:8649.

**Deferred in scope:** haven't-played in tournament/placement modes; visible unplayed filter; swipe-down-to-skip.
