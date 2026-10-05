# Changelog

## CHG-0010 · 2026-10-06 · Sign-in state fix + phone duel layout

Type: Code
Event: Delivery
Scope: Accounts · Duel layout

Summary: Two user-reported fixes. (1) The sign-in dialog could demand a name it wasn't showing: the sign-up/sign-in mode survived across dialog opens, so after a sign-up visit the form said "Sign in" while submit still ran the sign-up branch ("Pick a name…") and the mode toggle needed two clicks to visibly change. Mode state now lives in one `setMode()` that `openModal` always resets to sign-in. (2) Phones stacked the two duel cards full-size, pushing the second below the fold — "both options on screen" required scrolling. ≤610px now keeps the pair side by side and compact (full-width cards, smaller VS/type/meta), so both cards, the VS badge, and the haven't-played row fit one 390×844 screen; the sign-in dialog also compacts (smaller paddings/fields) so the three-field sign-up form fits without scrolling. Asset `?v=` tags bumped to `2026-10-06b` (the discipline: bump on every asset edit).
References: `auth.js` (`setMode`); `style.css` (≤610px and ≤560px blocks); `index.html`.
Validation: `node engine.test.js` passes; in-browser on a cache-busted origin — the exact failing repro (open → visit sign-up → close → reopen) now reopens as "Sign in" with the name row hidden and submits credentials successfully (was: "Pick a name for the ladder owner."); sign-up → chip → sign-out → repro sign-in all pass; 390px duel: both cards at y 372–683 with VS between and the skip row ending at 814 < 844. Note: local D1 state in `/tmp/pr-d1-state` was wiped by a reboot, taking the earlier test accounts — `dylan@test.dev` re-created; users must re-create accounts after any reboot until batch 5 (deploy) gives durable state.

## CHG-0009 · 2026-10-06 · Design pass: auth dialog, narrow header, stats charts

Type: Code
Event: Delivery
Scope: Visual design

Summary: Screenshot-driven pass over the weakest surfaces (identity untouched — same midnight-arcade palette, type, and card language). Auth dialog rebuilt as a text form: fitted 400px panel with an × close button, one full-width primary action, and the sign-up/sign-in mode switch demoted to a quiet text link (replacing the mismatched two-cream-button pair that wrapped badly on phones); copy tightened. Header at ≤560px is a named-row grid — logo + account + sound, then nav, then ladder select + duel count — so nothing wraps mid-row and the default ladder name fits untruncated; the signed-out header button now speaks the nav voice (Bricolage sentence case), the signed-in initial stays a pixel chip. Stats charts render at exact device resolution instead of stretching a fixed 900px buffer (text was soft at 1040px, unreadable on phones), with the top-10 label gutter measured from the actual titles and ellipsized by pixels rather than a character count. Stats tiles moved to an auto-fit grid with 1px-gap dividers that land only between cells. `index.html` now version-tags its CSS/JS URLs (`?v=YYYY-MM-DD`) so edits reach browsers on a normal reload instead of heuristic-cache limbo.
References: `auth.js`; `style.css` (§ auth dialog, § stats, ≤560px block); `views.js` (`chartCtx`, `fitLabel`, `drawTop10`, `drawHist`); `index.html`.
Validation: `node engine.test.js` passes (59/59); verified in-browser on a cache-busted origin — desktop dialog: single primary + link, × clears heading by 18px; 390px dialog: scrim visible, margins held, no wrapping; 390px header: three ordered rows, full "My all-time ladder" label at 192px; stats: canvas buffers match CSS size exactly (1002×401 / 1002×289 at dpr 1), titles readable, tile dividers between cells only; vision-model critique of before/after screenshots confirms the button-hierarchy fix (user-reported "buttons look awful" against the pre-fix pair).

## CHG-0008 · 2026-10-05 · BetterAuth accounts: sign-up, sign-in, sign-out

Type: Code
Event: Delivery
Scope: Multi-user · Batch 2

Summary: Accounts are live. `server/src/auth.ts` builds BetterAuth per-Workers-env over Drizzle-on-D1 (scoped dependency: Drizzle exists only as BetterAuth's adapter; app data stays raw D1), with the canonical 1.7.7 schema (`server/src/db/schema.ts`, CLI-generated) migrated via drizzle-kit → `server/migrations/` applied with `wrangler d1 migrations apply --local`. Hono mounts `/api/auth/*` plus `/api/me`; `BETTER_AUTH_SECRET` lives in `server/.dev.vars` (git-ignored) locally and as a Workers secret in production. The SPA gains a self-contained zero-dependency `auth.js`: a "Sign in" header button opening an app-styled modal (create-account toggle, inline errors, toasts), an initial-chip when signed in that signs out on click. `app.js` untouched.
Reason: First user-facing slice of the agreed multi-user architecture (CHG-0006): identity before sync, so batches 3–4 attach data to real accounts.
References: `server/src/{index,auth}.ts`; `server/src/db/schema.ts`; `server/migrations/`; `auth.js`; `style.css` § account; CHG-0006.
Validation: typecheck clean; curl e2e against `wrangler dev` — sign-up sets session, `/api/me` returns the user, sign-out clears it, sign-in re-establishes it, wrong password rejected (`INVALID_EMAIL_OR_PASSWORD`); browser e2e — modal sign-up closes and shows the header chip + toast, session survives reload, header-click signs out. Dev-loop incident found and fixed: wrangler watched the repo root (its assets dir) while its own D1 state under `server/.wrangler` triggered a reload loop — dev state now persists out-of-tree (`--persist-to /tmp/pr-d1-state`, baked into `npm run dev`). `node engine.test.js` passes.

## CHG-0007 · 2026-10-04 · Worker skeleton: app served + health + D1

Type: Code
Event: Delivery
Scope: Multi-user · Batch 1

Summary: `server/` now runs the multi-user stack's first slice: a Hono Worker (`server/src/index.ts`) with a `GET /api/health` endpoint that proves D1 connectivity, Cloudflare static assets serving the repo root (the whole current app: index, scripts, covers, v1 — with `.assetsignore` keeping internals like `documentation/`, `AGENTS.md`, pipelines, and the changelog unserved), and a `DB` D1 binding (placeholder id; local dev uses the built-in D1 simulation, no Cloudflare account needed).
References: `server/` (package.json, wrangler.jsonc, src/index.ts, tsconfig.json); `.assetsignore`; `README.md` § Multi-user server; CHG-0006 for the agreed architecture.
Validation: `npm run typecheck` clean in `server/`; verified against `wrangler dev` — `/api/health` returns `{"ok":true,"db":"d1"}` (real D1 roundtrip, 20 ms local), `/` serves the app (200 HTML), `/covers.js` and a cover asset serve (200), `/v1/` reachable (307 → 200), excluded paths 404 (`documentation/agents/domain.md`, `CHANGELOG.md`). Remote deploy deferred until the user runs `wrangler login` + `wrangler d1 create`.

## CHG-0006 · 2026-10-04 · Multi-user on Cloudflare Workers + D1 (architecture)

Type: Configuration
Event: Agreement
Scope: Multi-user

Summary: Multi-user Pixel Rumble will be built as a thin Hono API on Cloudflare Workers with D1, in front of the existing zero-dependency SPA (served as Worker static assets, offline-first localStorage kept). Auth via BetterAuth with its D1 adapter (user's choice over hand-rolled auth and OAuth). The global ranking is a shared Elo ladder computed server-side by the existing DOM-free `engine.js` replaying every user's battles (user-confirmed). Personal rankings remain per-user ladders synced through the API. Alternatives vetted and declined for this scope: Effect on Workers (framework weight exceeds the domain), Marko rewrite (technically viable on Workers via the official vite-cloudflare example but a full view-layer rewrite; may consume the same API later as a front-end project).
Reason: Adds accounts, sync, and a consensus ranking while preserving the working app, its offline-first UX, and free-tier zero-ops hosting; all new risk confined to a thin API layer.
References: `documentation/work-in-progress.md`; engine.js (DOM-free, reused verbatim server-side); marko-js/examples vite-cloudflare-marko-5 (vetted path for a future Marko front-end).
Validation: User approved the architecture after a vetted comparison (hosting verified for all three options; BetterAuth's first-class D1/Workers support confirmed).

## CHG-0005 · 2026-10-04 · Equal card heights regardless of title length

Type: Code
Event: Delivery
Scope: Duel cards

Summary: Duel-card meta blocks (title/platform/points) previously sized to their content, so a card with a wrapping title grew taller than its pair and the cards sat misaligned — long titles read as squeezing the artwork. Every card's meta area now reserves two title lines (CSS `min-height: 107px`), and each rendered pair equalizes to its taller card (`syncMetaHeights` in `views.js`, re-measured after web-font swap), so paired cards are always identical in height and alignment for any title length, without clipping or wasting space. Applies to quick duels and placement.
References: `style.css` (`.meta`); `views.js` (`syncMetaHeights`); CHG-0002.
Validation: measured in-browser on a fresh origin — a one-line vs two-line pair renders 107/107 metas and 507/507 cards; a forced three-line title ("The Elder Scrolls IV: Oblivion Game of the Year Edition (2009)") against a one-line opponent renders 128/128 metas, 528/528 cards, art areas 396/396, tops aligned to the pixel.

## CHG-0004 · 2026-10-04 · Cover art letterboxed, never cropped

Type: Code
Event: Delivery
Scope: Cover art

Summary: Cover art now renders with `object-fit: contain` — the frame stays fixed so layouts align, while the art inside keeps its true aspect ratio (one dimension fills, the other adapts), with the genre gradient as the letterbox. Fixes unreadable cropped fragments in the square ranking thumbnails and any other frame whose ratio doesn't match the art. Duel cards are visually unchanged (their 2:3 frame already matches the portrait art exactly).
References: `style.css` (`.sprite.photo`/`.thumb.photo`); CHG-0002.
Validation: verified in-browser on a fresh origin — 160/160 ranking thumbnails load with contain and show complete art (screenshot reviewed: logos fully readable, letterboxing tidy against the gradient cells); duel card geometry unchanged (264×396 art, contain, loaded); detail modal banner shows the complete header asset letterboxed (498×199, loaded).

## CHG-0003 · 2026-10-04 · Pick by card, key, or swipe

Type: Code
Event: Delivery
Scope: Duel controls

Summary: The redundant pick-button rows are gone ("Pick left/right", "X is better"). Picking is now card click, horizontal swipe toward a card on touch screens (rows only claim horizontal gestures; vertical pans still scroll), or the arrow keys; `↓` joins `S` for skipping a quick-duel pair and `U` still undoes. A quiet hint line under the cards states the keys on desktop and the swipe on touch. Placement keeps its Stop button; tournament was already click-plus-arrows and is unchanged; the `?` shortcuts list now includes `↓`.
References: `views.js` (`swipePicks`, `duelHint`, quick/placement panes); `app.js` (keydown, shortcuts modal); `style.css`; `README.md` § What V2 adds.
Validation: `node engine.test.js` passes; verified in-browser on a fresh origin — zero pick/skip/undo buttons rendered, `→` picked the right card (duel count and live announcement confirm), `↓` rotated the pair without a duel, a synthetic left swipe picked the left card, placement shows no "is better" buttons with Stop intact; screenshot reviewed.

## CHG-0002 · 2026-10-04 · Portrait-native covers + haven't-played skips

Type: Code
Event: Delivery
Scope: Cover art · Quick duels

Summary: Cover art is no longer forced through landscape crops: duel cards and the champion screen show portrait library art in full-height 2:3 frames, the game detail banner uses the landscape header asset, and `fetch-covers.js` now downloads both variants per game, recording true pixel dimensions parsed from the JPEG bytes. Quick duels gained "Haven't played <game>" / "Haven't played either" controls: flagged games are excluded from quick-duel pairing (falling back to the full pool when fewer than two remain), no rating change is recorded, flags persist per ladder, and each game's detail card carries a played/not-played toggle so the flag is reversible.
References: `fetch-covers.js`; `covers.js`; `app.js` (`coverOf`/`applyArt` frame variants, `markUnplayed`/`togglePlayed`, `poolGames`); `views.js`; `style.css`; `README.md` § Cover art.
Validation: `node engine.test.js` passes; 160/160 games fetched with both variants, zero misses; duel cards verified visually (uncropped 2:3 art); haven't-played flow verified in-browser — flag persisted across reload, flagged games absent from 12 subsequent pairings, pool never dead-ended; modal banner verified on the header asset with the toggle flipping the flag in place; fallback chain traced: missing variant → other variant → pixel sprite; 160/160 ranking thumbnails load.

## CHG-0001 · 2026-10-04 · Cover art for every game

Type: Code
Event: Delivery
Scope: Cover art

Summary: Every roster game now shows real Steam cover art. `fetch-covers.js` downloads each game's portrait library art (`header.jpg` fallback) into `covers/` and writes a `covers.js` manifest; `app.js` (`coverOf`/`applyArt`) renders it across duel cards, ranking/stats thumbnails, the champion box, and the game detail modal, falling back to the generated pixel sprite when no cover exists (curated classics, deleted files). See `README.md` § Cover art.
References: `fetch-covers.js`; `covers.js`; `app.js` (`coverOf`, `applyArt`); `views.js` art sites; `style.css` `.photo` rules; `README.md` § Cover art.
Validation: `node engine.test.js` passes; 160/160 covers fetched, zero misses; duel cards, all 160 ranking thumbs, and the detail modal verified visually in-browser; missing-cover fallback to the pixel sprite tested in-page; incremental re-run verified (160 kept, 0 downloaded).
