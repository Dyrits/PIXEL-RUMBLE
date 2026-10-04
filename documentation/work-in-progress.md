# Work in progress

## Awaiting acceptance: duel-screen changes (CHG-0002 – CHG-0005)

All batches implemented, verified, and delivered; user review is pending since the duel screen's appearance and interactions changed. View at http://localhost:8649 (fresh origin — older ports may serve stale assets from browser cache; hard-reload if needed).

- CHG-0002: portrait-native covers (2:3 frames) + "haven't played" skips with per-ladder flags, reversible from each game's card.
- CHG-0003: pick by card click, arrow keys, or horizontal swipe; pick-button rows removed; `↓`/`S` skip, `U` undo.
- CHG-0004: cover art letterboxed (`object-fit: contain`) — frames fixed, art aspect preserved, no more cropped fragments in thumbnails or mismatched frames.
- CHG-0005: paired duel cards always equal height regardless of title length (two-line meta baseline + per-pair equalization).

**Deferred in scope** (not ruled out): "haven't played" in tournament and placement modes; rating semantics for unplayed games; per-ladder unplayed view/filter (only the flag exists today); swipe-down-to-skip on touch (currently swipe picks only — down-swipe was left to page scrolling to avoid accidental skips).
