# Pixel Rumble

A [Flickchart](https://www.flickchart.com/) for video games. Two games walk in,
you pick the one you think is better, and an Elo ladder quietly assembles your
personal all-time ranking from those snap judgments.

**This is V2.** The original prototype lives in [`v1/`](v1/) and still runs
on its own (`v1/index.html`).

## Run it

No build step. Open `index.html` directly, or serve it:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## What V2 adds over the prototype

- **Multiple ladders.** Keep parallel rankings — all-time, a decade, a genre,
  one per household member — and switch between them from the header. Rename,
  delete, and reset each independently.
- **Three ways to duel.**
  - *Quick duel* — the classic matchup, with era and genre filters that
    constrain the pool, and "haven't played" skips that keep games you
    haven't played out of the rotation (reversible from a game's card).
    Pick by clicking a card, swiping toward it on touch screens, or the
    arrow keys; `↓` skips the pair and `U` undoes the last duel.
  - *Tournament* — 8- or 16-game single-elimination brackets, drawn randomly
    or seeded by rating. Every match is a real duel that moves the ladder;
    the champion gets a coronation, and past champions are enshrined on the
    Stats tab.
  - *Slot a game* — Flickchart-style ranking insertion. Pick any game (or
    surprise-me with an unrated one), answer ~7 head-to-heads, and a binary
    search drops it exactly where it belongs in your ranking.
- **A real rankings table.** Sortable by rating, title, year, duels or win
  rate; S/A/B/C/D tier chips computed from your ladder; win/loss streak
  badges; medal colors for the podium.
- **Game cards.** Click any game for rating, rank, record, streak, best win,
  worst loss, a rating-history sparkline, and its head-to-head records —
  plus shortcuts to duel it or slot it into the ranking.
- **Stats tab.** Duels, roster coverage, longest streak, biggest upset,
  most-duelled game, a top-10 bar chart, the rating spread, genre leaders,
  closest rivalry, and the hall of champions.
- **Sound.** A tiny WebAudio synth — coins, shuffles, a champion fanfare.
  Mute it from the header; the preference sticks.
- **Data you own.** Export any ladder to JSON, import it anywhere, and if a
  V1 save exists in the browser you'll be offered a one-click migration.
- **Onboarding.** First run names your ladder and gets you straight to the
  first duel.

## The data pipeline

The bundled roster is **generated from public APIs** by
[`fetch-data.js`](fetch-data.js) — no API keys, no dependencies:

- [SteamSpy](https://steamspy.com/api.php) supplies the catalog (ordered by
  owners) with review tallies and developers.
- [Wikidata](https://query.wikidata.org/) supplies release dates, genres and
  platforms, joined exactly on the Steam application ID (property P1733).
  The join doubles as a notability filter — only games with a curated
  knowledge-base entry survive.
- Selection is water-filled across decades so the roster spans eras instead of
  collapsing onto recent releases.

```sh
node fetch-data.js                      # 160 games from the APIs
node fetch-data.js --limit 240 --pages 6
node fetch-data.js --with-curated       # merge in the 147 classics from
                                        # data/games-curated.js (1972-2025)
```

Raw responses are cached in `.cache-data/` (git-ignored), so re-runs are
instant and an interrupted crawl resumes where it left off. Steam's catalog
starts in the early 1990s, so era chips before the 90s only fill up with
`--with-curated`. Swapping rosters is safe: battles referencing games that no
longer exist are dropped automatically on load, and ladders re-seed any new
games at 1500.

## Cover art

Every game with a Steam appid carries real cover art in two variants,
downloaded by [`fetch-covers.js`](fetch-covers.js) from Steam's public CDN:

- portrait library art (`covers/<appid>.jpg`) — duel cards, champion screen,
  thumbnails; shown uncropped in portrait frames,
- landscape header art (`covers/<appid>.h.jpg`) — the game detail banner.

The `covers.js` manifest records both with their true pixel size (read from
the JPEG bytes, since the CDN's "600x900" is not always 600x900):

```sh
node fetch-covers.js              # fetch missing variants, rewrite the manifest
node fetch-covers.js --force      # re-download everything
```

Re-runs are incremental (existing files are kept), so run it again after
regenerating the roster. Games without fetched art — including the curated
classics, which have no appid — render their generated pixel sprite instead;
that fallback also covers deleted files and a missing variant falls back to
the other one, so the app never shows a broken image.

## How the ladder works

Every game starts at 1500. A duel swaps points by the standard Elo
expected-score formula; upsets move more than expected results. Newcomers
swing harder (K = 40, then 32, settling at 24) so rankings take shape fast
and then stabilize. Matchmaking prefers unrated games and close ratings —
where a vote carries the most information — and holds back the last few games
you saw. Everything persists in `localStorage` under `pixel-rumble.v2`.

## Roster

`games.js` is generated by the pipeline above (see `fetch-data.js --help`
behavior at the top of that file). `data/games-curated.js` keeps the
hand-picked 147-game set spanning 1972–2025 as a fallback and as merge
material. One entry per game, no remakes. Edit either freely; records for new
games are seeded automatically.

## Tests

The engine — ratings, matchmaking, sprites, brackets, placement, tiers,
stats, migration — is DOM-free and tested with plain Node:

```sh
node engine.test.js
```

## Multi-user server

[`server/`](server/) is a Cloudflare Worker that serves this app as static
assets (the repo root; see `.assetsignore` for what stays private) and hosts
the multi-user API: BetterAuth accounts, per-user ladder sync, and a global
ranking computed by the same `engine.js`. Local dev needs no Cloudflare
account — D1 runs in a local simulation:

```sh
cd server
npm install
npm run dev:node      # http://localhost:8791 — app + API, no wrangler needed
npm run typecheck
npm run dev           # wrangler dev on :8790 (see caveat below)
```

`npm run dev:node` is the self-contained dev loop: it bundles the Worker
with esbuild, backs the D1 binding with Node's built-in SQLite (migrations
applied on boot, state in `/tmp/pr-node-d1` — delete to reset), serves the
repo root, and forwards `/api/*` to the Worker. Prefer it when `wrangler
dev` misbehaves on your machine — it has been observed failing at startup
(`spawn EBADF` inside its esbuild/workerd bootstrap) while everything else
works.

**Accounts** (BetterAuth, email + password): "Sign in" in the header,
session cookie, sign-out on the header chip. **Ladder sync:** signed in,
your whole ladder state syncs after every duel (debounced) and merges on
sign-in — duels are an append-only log replayed through the engine, so two
devices merge by union, never overwrite. Offline play keeps working; the
next duel syncs. **Global ranking:** the "Global" tab ranks every signed-in
player's duels in one shared Elo ladder, computed server-side by the same
DOM-free `engine.js` and cached briefly.

First deploy: `npx wrangler login`, `npx wrangler d1 create pixel-rumble`
(paste the id into `server/wrangler.jsonc`), apply migrations remotely
(`npx wrangler d1 migrations apply pixel-rumble --remote`), set the auth
secret (`npx wrangler secret put BETTER_AUTH_SECRET` — locally it lives in
`server/.dev.vars`, which is git-ignored), then `npm run deploy`.

## Layout

| File | What it is |
| --- | --- |
| `index.html` | Shell, fonts, header/footer chrome |
| `style.css` | The whole visual identity |
| `games.js` | The game roster |
| `covers.js` + `covers/` | Cover art manifest and downloaded box art |
| `engine.js` | Pure logic: Elo, matchmaking, sprites, tournaments, placement, stats |
| `audio.js` | WebAudio synth for arcade feedback |
| `views.js` | Renderers for Duel, Rankings and Stats |
| `app.js` | Store, ladders, actions, chrome, keyboard, onboarding |
| `auth.js` | Account dialog + header chip (BetterAuth REST, zero-dep) |
| `sync.js` | Ladder sync client + Global-tab data |
| `fetch-data.js` | Roster pipeline: SteamSpy + Wikidata, keyless, cached |
| `fetch-covers.js` | Cover pipeline: Steam CDN box art into `covers/` |
| `data/games-curated.js` | Hand-picked classic roster (fallback + merge source) |
| `engine.test.js` | Engine tests |
| `v1/` | The original prototype, preserved |
