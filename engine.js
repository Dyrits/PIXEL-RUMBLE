// Pixel Rumble V2 engine: pure, DOM-free logic for ratings, matchmaking,
// sprites, tournaments, ranking placement, tiers and ladder statistics.
// In the browser it attaches to window; Node tests require it directly.
(function (global) {
  "use strict";

  const START_RATING = 1500;
  const RATING_FLOOR = 100;

  // ---------- hashing / randomness ----------

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

  // ---------- ratings ----------

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

  // ---------- matchmaking ----------

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

  // ---------- sprites ----------

  // 7x7 horizontally-mirrored sprite pattern: 0 empty, 1 body, 2 shade, 3 eye.
  // Center-weighted density, a smoothing pass, a guaranteed face and feet, and
  // a hash-chosen accessory (antenna / horns / crest) plus mouth. Deterministic
  // per seed; retries avoid degenerate emptiness.
  function spriteGrid(seed) {
    let grid;
    let best = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      grid = buildGrid((seed + attempt * 0x9e3779b9) >>> 0);
      const empty = grid.flat().filter((v) => v === 0).length;
      if (empty >= 8 && empty <= 28) return grid;
      // Keep the closest-to-band grid in case every attempt misses.
      if (best === null || Math.abs(empty - 18) < best.gap) best = { grid, gap: Math.abs(empty - 18) };
    }
    return best ? best.grid : grid;
  }

  function buildGrid(seed) {
    const rng = seededRng(seed);
    const size = 7;
    const half = 4; // columns 0..3 are generated and mirrored into 4..6
    const colW = [0.35, 0.62, 0.88, 1.0];
    const rowW = [0.5, 0.78, 1.05, 1.05, 1.0, 0.72, 0.42];
    const grid = [];
    for (let y = 0; y < size; y++) {
      const row = new Array(size).fill(0);
      for (let x = 0; x < half; x++) {
        const p = Math.min(0.92, 0.74 * colW[x] * rowW[y]);
        if (rng() < p) {
          row[x] = rng() < 0.3 && y >= 3 ? 2 : 1;
          row[size - 1 - x] = row[x];
        }
      }
      grid.push(row);
    }
    smooth(grid);
    // Core guarantee: the 3x3 body block stays solid so no seed can produce a
    // stick figure. Fill center-out in mirrored pairs until 6 of 9 are on.
    const coreOrder = [[3, 2], [3, 4], [2, 3], [4, 3], [4, 2], [4, 4]];
    let coreOn = 0;
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) if (grid[y][x] !== 0) coreOn += 1;
    for (const [y, x] of coreOrder) {
      if (coreOn >= 6) break;
      if (grid[y][x] === 0) { grid[y][x] = 1; coreOn += 1; }
    }
    // Face: eyes at (2,2)/(2,4) with brow/body around them so it always reads
    // as a creature. Symmetric by construction.
    grid[2][2] = 3;
    grid[2][4] = 3;
    if (grid[2][1] === 0) grid[2][1] = 1;
    if (grid[2][5] === 0) grid[2][5] = 1;
    // Mouth.
    if (grid[4][3] === 0) grid[4][3] = 3;
    // Feet.
    if (grid[6][2] === 0) grid[6][2] = 1;
    if (grid[6][4] === 0) grid[6][4] = 1;
    // Accessory: none / antenna / horns / crest, chosen by the leftover
    // randomness so every game keeps its look forever.
    const acc = Math.floor(rng() * 4);
    if (acc === 1) grid[0][3] = 1;
    else if (acc === 2) {
      if (grid[1][1] === 0) grid[1][1] = 1;
      if (grid[1][5] === 0) grid[1][5] = 1;
    } else if (acc === 3) {
      grid[0][2] = 1;
      grid[0][4] = 1;
    }
    // Guarantee some depth shading: darken a couple of lower body pixels.
    let shade = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (grid[y][x] === 2) shade += 1;
    outer:
    for (const y of [5, 4, 6, 3]) {
      for (const x of [2, 1, 3]) {
        if (shade >= 4) break outer;
        if (grid[y][x] === 1 && grid[y][size - 1 - x] === 1) {
          grid[y][x] = 2;
          grid[y][size - 1 - x] = 2;
          shade += 2;
        }
      }
    }
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

  // ---------- tournaments ----------

  // Standard single-elimination seed order: for n=8 -> [1,8,4,5,2,7,3,6],
  // so slot i meets slot i+1 and seeds separate evenly in later rounds.
  function seedSlots(n) {
    let s = [1, 2];
    while (s.length < n) {
      const m = s.length * 2 + 1;
      const next = [];
      for (const x of s) next.push(x, m - x);
      s = next;
    }
    return s;
  }

  // ids: participants ordered by strength (best first) when seeded, or an
  // already-shuffled list when not. Returns {size, seeding, rounds} where
  // rounds[0] is the first round of matches; later rounds hold empty slots.
  function createBracket(ids) {
    const size = ids.length;
    const rounds = [];
    let roundSize = size / 2;
    while (roundSize >= 1) {
      const matches = [];
      for (let i = 0; i < roundSize; i++) {
        matches.push({ a: null, b: null, winner: null });
      }
      rounds.push(matches);
      roundSize /= 2;
    }
    const slots = seedSlots(size);
    for (let i = 0; i < size; i += 2) {
      const m = rounds[0][i / 2];
      m.a = ids[slots[i] - 1];
      m.b = ids[slots[i + 1] - 1];
    }
    return { size, rounds };
  }

  // Records a winner for rounds[r][m] and propagates: when a round completes,
  // its winners fill the next round. Returns the same bracket (mutated).
  function pickWinner(bracket, r, m, winnerId) {
    const match = bracket.rounds[r][m];
    if (!match || match.winner || (winnerId !== match.a && winnerId !== match.b)) return false;
    match.winner = winnerId;
    if (r + 1 < bracket.rounds.length) {
      const next = bracket.rounds[r + 1][Math.floor(m / 2)];
      if (m % 2 === 0) next.a = winnerId;
      else next.b = winnerId;
    }
    return true;
  }

  // First undecided match in reading order, or null when the bracket is done.
  function nextMatch(bracket) {
    for (let r = 0; r < bracket.rounds.length; r++) {
      for (let m = 0; m < bracket.rounds[r].length; m++) {
        const match = bracket.rounds[r][m];
        if (match.a && match.b && !match.winner) return { r, m };
      }
    }
    return null;
  }

  function championOf(bracket) {
    const final = bracket.rounds[bracket.rounds.length - 1][0];
    return final && final.winner ? final.winner : null;
  }

  // ---------- placement (binary search into the ranking) ----------

  // list: ids of the other games in ladder order (best first). Each answer
  // halves the window; ~ceil(log2(n)) duels place the candidate.
  function placementNew(list, candidateId) {
    return { cand: candidateId, list, lo: 0, hi: list.length, steps: 0 };
  }

  function placementStep(st) {
    if (st.hi - st.lo <= 1) return { done: true, insertAt: st.lo };
    const mid = Math.floor((st.lo + st.hi) / 2);
    return { done: false, oppId: st.list[mid], mid };
  }

  function placementAnswer(st, candBetter) {
    const mid = Math.floor((st.lo + st.hi) / 2);
    if (candBetter) st.hi = mid;
    else st.lo = mid + 1;
    st.steps += 1;
  }

  // ---------- tiers ----------

  // Tier letter by position among rated games: top 8% S, next 17% A,
  // next 25% B, next 30% C, bottom 20% D.
  function tierForIndex(index, total) {
    if (total === 0) return null;
    const p = index / total;
    if (p < 0.08) return "S";
    if (p < 0.25) return "A";
    if (p < 0.5) return "B";
    if (p < 0.8) return "C";
    return "D";
  }

  // ratedOrder: ids of games with at least one duel, best first.
  // Returns {id -> tier} (unrated games are absent).
  function computeTiers(ratedOrder) {
    const tiers = {};
    ratedOrder.forEach((id, i) => {
      tiers[id] = tierForIndex(i, ratedOrder.length);
    });
    return tiers;
  }

  // ---------- ladder statistics ----------

  // battles: [{a, b, winner, preA, preB, ...}] in chronological order.
  function ladderStats(recs, battles) {
    const rated = Object.values(recs).filter((r) => r.w + r.l > 0);
    const stats = {
      duels: battles.length,
      ratedCount: rated.length,
      currentStreaks: {},
      longestStreak: null,
      biggestUpset: null,
      mostDueled: null,
      rivalry: null,
    };

    // Current win/loss streak per game.
    for (const b of battles) {
      const loser = b.a === b.winner ? b.b : b.a;
      stats.currentStreaks[b.winner] = streakStep(stats.currentStreaks[b.winner], "W");
      stats.currentStreaks[loser] = streakStep(stats.currentStreaks[loser], "L");
    }

    // Longest all-time streak and most-duelled game need per-game passes.
    const byGame = new Map();
    for (const b of battles) {
      for (const id of [b.a, b.b]) {
        if (!byGame.has(id)) byGame.set(id, []);
        byGame.get(id).push({ oppResultForThisGame: b.winner === id });
      }
    }
    for (const [id, results] of byGame) {
      let run = 0, best = 0;
      for (const r of results) {
        run = r.oppResultForThisGame ? run + 1 : 0;
        if (run > best) best = run;
      }
      if (best > 0 && (!stats.longestStreak || best > stats.longestStreak.n)) {
        stats.longestStreak = { id, type: "W", n: best };
      }
      if (!stats.mostDueled || results.length > stats.mostDueled.n) {
        stats.mostDueled = { id, n: results.length };
      }
    }

    // Biggest upset: winner entered with the lower rating.
    for (const b of battles) {
      if (!b.preA || !b.preB) continue;
      const preWinner = b.winner === b.a ? b.preA.r : b.preB.r;
      const preLoser = b.winner === b.a ? b.preB.r : b.preA.r;
      const gap = preLoser - preWinner;
      if (gap > 0 && (!stats.biggestUpset || gap > stats.biggestUpset.gap)) {
        stats.biggestUpset = {
          winner: b.winner,
          loser: b.winner === b.a ? b.b : b.a,
          gap,
        };
      }
    }

    // Rivalry: the most-frequent head-to-head pair.
    const pairs = new Map();
    for (const b of battles) {
      const key = [b.a, b.b].sort().join("|");
      if (!pairs.has(key)) pairs.set(key, { a: null, b: null, aWins: 0, bWins: 0, matches: 0 });
      const p = pairs.get(key);
      if (p.matches === 0) { p.a = key.split("|")[0]; p.b = key.split("|")[1]; }
      p.matches += 1;
      if (b.winner === p.a) p.aWins += 1;
      else p.bWins += 1;
    }
    for (const p of pairs.values()) {
      if (p.matches >= 2 && (!stats.rivalry || p.matches > stats.rivalry.matches)) {
        stats.rivalry = p;
      }
    }

    return stats;
  }

  function streakStep(prev, type) {
    if (!prev || prev.type !== type) return { type, n: 1 };
    return { type, n: prev.n + 1 };
  }

  // Head-to-head records for one game: [{opp, wins, losses}] sorted by matches.
  function headToHead(battles, id) {
    const map = new Map();
    for (const b of battles) {
      if (b.a !== id && b.b !== id) continue;
      const opp = b.a === id ? b.b : b.a;
      if (!map.has(opp)) map.set(opp, { opp, wins: 0, losses: 0 });
      const rec = map.get(opp);
      if (b.winner === id) rec.wins += 1;
      else rec.losses += 1;
    }
    return [...map.values()].sort((x, y) => (y.wins + y.losses) - (x.wins + x.losses));
  }

  // ---------- charts ----------

  function histogram(values, binSize) {
    if (!values.length) return { bins: [], min: 0, binSize };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const count = Math.max(1, Math.ceil((max - min + 1) / binSize));
    const bins = new Array(count).fill(0);
    for (const v of values) {
      bins[Math.min(count - 1, Math.floor((v - min) / binSize))] += 1;
    }
    return { bins, min, binSize };
  }

  // ---------- storage migration ----------

  // Imports a V1 save ({recs, battles}) as a V2 ladder object.
  function migrateV1(raw) {
    if (!raw || typeof raw !== "object" || !raw.recs) return null;
    const recs = {};
    for (const [id, rec] of Object.entries(raw.recs)) {
      recs[id] = {
        r: Number(rec.r) || START_RATING,
        w: Number(rec.w) || 0,
        l: Number(rec.l) || 0,
        hist: Array.isArray(rec.hist) && rec.hist.length ? rec.hist.map(Number) : [Number(rec.r) || START_RATING],
      };
    }
    const battles = (Array.isArray(raw.battles) ? raw.battles : []).map((b) => ({
      a: b.a, b: b.b, winner: b.winner, mode: "quick", ts: 0,
      preA: b.preA || null, preB: b.preB || null,
    })).filter((b) => b.a && b.b && b.winner);
    return {
      id: "v1-" + Date.now().toString(36),
      name: "V1 ladder",
      recs, battles,
      tournaments: [],
      currentTournament: null,
    };
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
    seedSlots,
    createBracket,
    pickWinner,
    nextMatch,
    championOf,
    placementNew,
    placementStep,
    placementAnswer,
    tierForIndex,
    computeTiers,
    ladderStats,
    headToHead,
    histogram,
    migrateV1,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = engine;
  else global.PixelRumbleEngine = engine;
})(typeof window !== "undefined" ? window : globalThis);
