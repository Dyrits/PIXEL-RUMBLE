# Work in progress

## Multi-user milestone — batches 1–4 delivered (CHG-0006 agreement, baseline revision 55b7ef1); batch 5 (deploy) next

**Delivered:** worker skeleton + accounts (CHG-0007/0008), design pass + fixes (CHG-0009/0010), ladder sync + global ranking (CHG-0011 — includes the milestone review, both axes verified, and an architecture audit). `node engine.test.js` 84/84; server typecheck clean; browser e2e 12/12 against the Node harness.

**Next: batch 5 — deploy.** Blocked on the user's Cloudflare account: `npx wrangler login` (interactive OAuth), then `npx wrangler d1 create pixel-rumble` (paste id into `server/wrangler.jsonc`), `npx wrangler d1 migrations apply pixel-rumble --remote`, `npx wrangler secret put BETTER_AUTH_SECRET`, `npm run deploy` in `server/`, smoke test `/api/health` + sign-up + sync + global on the deployed URL. Deploy-time verification of Workers-assets semantics is the open SPEC-2 note from the milestone review.

**Open review notes (documented in CHG-0011):** Drizzle-scoped-to-auth boundary is comment-enforced only (SPEC-3); design-pass appearance acceptance is with the user (SPEC-4).

**Architecture audit** (2026-10-06): `documentation/architecture-audit/architecture-audit-20261006-0729.html` — 5 candidates; top pick: one battle-constructor in engine.js shared by live duels, undo, merge, and server replay. Refinement of any candidate awaits the user's pick.

## Awaiting acceptance: user review pending

- CHG-0002 – CHG-0005 (duel-screen changes; freshest verification origin was http://localhost:8649, now stale — re-verify against a fresh server).
- CHG-0009 / CHG-0010 (design pass + sign-in/phone fixes).
- CHG-0011 (sync + Global tab) — browser-verifiable against `npm run dev:node` (http://localhost:8791): sign in on two browsers/profiles, duel on each, watch merge + Global.
- Deferred in scope (unchanged): haven't-played in tournament/placement modes; visible unplayed filter; swipe-down-to-skip; Global-tab sorting/filters; per-user weighting caps on the global ladder (deferred until spam is observed).

## Dev environment

- **`wrangler dev` cannot start on this machine** (spawn EBADF in its esbuild/workerd bootstrap; every variant tried — see CHG-0011 Validation). Use `cd server && npm run dev:node` (port 8791) — bundles with esbuild-async + wrangler conditions, D1 over `node:sqlite` at `/tmp/pr-node-d1` (delete to reset; migrations auto-apply), statics honour `.assetsignore`. Wrangler still works for bundling (`deploy --dry-run`), D1 migrations, and typecheck-adjacent commands; retry `wrangler dev` after any OS/Node change.
- BetterAuth POST endpoints require an `Origin` header matching `BETTER_AUTH_URL` (CSRF) — curl e2e must send `-H "Origin: http://localhost:8791"`.
- Asset edits require bumping `?v=` in `index.html` (now `2026-10-06e`); verify with a cache-busted document URL (`?b=<n>`), never an already-open tab.
- `server/.dev.vars` (local BetterAuth secret) is git-ignored; verify it never gets committed.
