# Changelog

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
