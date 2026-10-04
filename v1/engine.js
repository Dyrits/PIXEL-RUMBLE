// Pixel Rumble engine: pure, DOM-free logic for ratings, matchmaking and sprite
// generation. In the browser it attaches to window; Node tests import it directly.
(function (global) {
  "use strict";

  const START_RATING = 1500;
  const RATING_FLOOR = 100;

  // FNV-1a: stable 32-bit hash of a string, used to seed sprites.
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32: tiny seeded PRNG so matchups and sprites can be reproduced.
  // The seed is scrambled and the first outputs discarded: raw mulberry32
  // correlates consecutive outputs for some seeds, which skews sprite shading.
  function seededRng(seed) {
    let a = (seed ^ 0x9e3779b9) >>> 0;
    const step = function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 8; i++) step();
    return step;
  }

  function freshRecord() {
    return { r: START_RATING, w: 0, l: 0, hist: [START_RATING] };
  }

  // Expected score of a against b (Elo, 400-point scale).
  function expected(ra, rb) {
    return 1 / (1 + Math.pow(10, (rb - ra) / 400));
  }

  // Newcomers swing harder so the ladder settles quickly; veterans stabilize.
  function kFactor(battles) {
    if (battles < 5) return 40;
    if (battles < 15) return 32;
    return 24;
  }

  // Applies a duel to two record objects in place and returns the rating deltas.
  // winnerId must be aId or bId. Records: {r, w, l, hist}.
  function duel(aId, recA, bId, recB, winnerId) {
    const ea = expected(recA.r, recB.r);
    const ka = kFactor(recA.w + recA.l);
    const kb = kFactor(recB.w + recB.l);
    const aWins = winnerId === aId;
    const prevA = recA.r;
    const prevB = recB.r;
    recA.r = Math.max(RATING_FLOOR, recA.r + Math.round(ka * ((aWins ? 1 : 0) - ea)));
    recB.r = Math.max(RATING_FLOOR, recB.r + Math.round(kb * ((aWins ? 0 : 1) - (1 - ea))));

    if (aWins) { recA.w += 1; recB.l += 1; }
    else { recB.w += 1; recA.l += 1; }
    recA.hist.push(recA.r);
    recB.hist.push(recB.r);
    if (recA.hist.length > 120) recA.hist.shift();
    if (recB.hist.length > 120) recB.hist.shift();

    return { deltaA: recA.r - prevA, deltaB: recB.r - prevB };
  }

  // Weighted pick: games with fewer duels surface more often (exploration),
  // everything still has a floor weight so the ladder keeps mixing.
  function weightedPick(items, weightOf, rng) {
    let total = 0;
    for (const it of items) total += weightOf(it);
    let roll = rng() * total;
    for (const it of items) {
      roll -= weightOf(it);
      if (roll <= 0) return it;
    }
    return items[items.length - 1];
  }

  // Chooses an informative pair: A is bias-toward-unranked, B is the closest
  // rating to A among a random sample. Avoids recentIds when the pool allows.
  // pool: [{id, r, battles}], recentIds: []string, rng: () => [0,1).
  function pickPair(pool, recentIds, rng, forcedId) {
    if (pool.length < 2) return null;
    const recent = new Set(recentIds || []);
    let candidates = pool.filter((g) => !recent.has(g.id));
    if (candidates.length < 2) candidates = pool.slice();

    const weightOf = (g) => 1 + 14 / (1 + g.battles);
    const a = forcedId && candidates.some((g) => g.id === forcedId)
      ? candidates.find((g) => g.id === forcedId)
      : weightedPick(candidates, weightOf, rng);

    let others = candidates.filter((g) => g.id !== a.id);
    if (others.length === 0) others = pool.filter((g) => g.id !== a.id);
    if (others.length === 0) return null;

    const sample = [];
    const n = Math.min(10, others.length);
    for (let i = 0; i < n; i++) {
      sample.push(others[Math.floor(rng() * others.length)]);
    }
    let best = sample[0];
    let bestGap = Math.abs(best.r - a.r);
    for (const g of sample) {
      const gap = Math.abs(g.r - a.r);
      if (gap < bestGap || (gap === bestGap && rng() < 0.5)) {
        best = g;
        bestGap = gap;
      }
    }
    return [a.id, best.id];
  }

  // 7x7 horizontally-mirrored sprite pattern: 0 empty, 1 body, 2 shade.
  // Density is weighted toward the middle (blob core), a face is guaranteed
  // (eyes at row 2, columns 2/4), and feet anchor the bottom. Deterministic
  // per seed; retries (seed + golden-ratio step) avoid degenerate emptiness.
  function spriteGrid(seed) {
    let grid;
    for (let attempt = 0; attempt < 5; attempt++) {
      grid = buildGrid((seed + attempt * 0x9e3779b9) >>> 0);
      const flat = grid.flat();
      const empty = flat.filter((v) => v === 0).length;
      const shade = flat.filter((v) => v === 2).length;
      if ((empty >= 8 && empty <= 26 && shade >= 3) || attempt === 4) return grid;
    }
    return grid;
  }

  function buildGrid(seed) {
    const rng = seededRng(seed);
    const size = 7;
    const half = 4; // columns 0..3 are generated and mirrored into 4..6
    // Column/row weights: sparse at the edges, solid at the core.
    const colW = [0.35, 0.62, 0.88, 1.0];
    const rowW = [0.5, 0.78, 1.05, 1.05, 1.0, 0.72, 0.42];
    const grid = [];
    for (let y = 0; y < size; y++) {
      const row = new Array(size).fill(0);
      for (let x = 0; x < half; x++) {
        const p = Math.min(0.92, 0.68 * colW[x] * rowW[y]);
        if (rng() < p) {
          row[x] = rng() < 0.3 && y >= 3 ? 2 : 1;
          row[size - 1 - x] = row[x];
        }
      }
      grid.push(row);
    }
    smooth(grid);
    // Face: eyes at (2,2)/(2,4) with brow/body around them so it always reads
    // as a creature. Symmetric by construction.
    const eye = 3;
    grid[2][2] = eye;
    grid[2][4] = eye;
    if (grid[2][1] === 0) grid[2][1] = 1;
    if (grid[2][5] === 0) grid[2][5] = 1;
    if (grid[3][3] === 0) grid[3][3] = 1;
    // Feet: two stubs on the bottom row.
    if (grid[6][2] === 0) grid[6][2] = 1;
    if (grid[6][4] === 0) grid[6][4] = 1;
    return grid;
  }

  // One cellular-automata pass: drop isolated pixels, fill enclosed holes.
  // Chunkier, more creature-like blobs; preserves horizontal symmetry.
  function smooth(grid) {
    const size = 7;
    const on = (y, x) =>
      y >= 0 && y < size && x >= 0 && x < size && grid[y][x] !== 0 ? 1 : 0;
    const next = grid.map((r) => r.slice());
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = on(y - 1, x) + on(y + 1, x) + on(y, x - 1) + on(y, x + 1);
        if (grid[y][x] !== 0 && n === 0) next[y][x] = 0;
        else if (grid[y][x] === 0 && n >= 3) next[y][x] = 1;
      }
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) grid[y][x] = next[y][x];
  }

  const engine = {
    START_RATING,
    RATING_FLOOR,
    hash,
    seededRng,
    freshRecord,
    expected,
    kFactor,
    duel,
    pickPair,
    spriteGrid,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = engine;
  else global.PixelRumbleEngine = engine;
})(typeof window !== "undefined" ? window : globalThis);
