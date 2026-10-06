// Node smoke tests for the V2 engine. Run: node engine.test.js
const E = require("./engine.js");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`ok  ${name}`);
  else { failures++; console.error(`FAIL ${name}`); }
}

// --- ratings ---
check("even match expected 0.5", Math.abs(E.expected(1500, 1500) - 0.5) < 1e-9);
check("+200 favorite ~0.76", Math.abs(E.expected(1700, 1500) - 0.760) < 0.001);
check("k factor ladder", E.kFactor(0) === 40 && E.kFactor(5) === 32 && E.kFactor(15) === 24);
{
  const a = E.freshRecord();
  const b = E.freshRecord();
  const d = E.duel("a", a, "b", b, "a");
  check("even duel +20/-20", d.deltaA === 20 && d.deltaB === -20);
  check("records update", a.r === 1520 && a.w === 1 && b.l === 1 && a.hist.length === 2);
}
{
  const low = { ...E.freshRecord(), r: 110 };
  const high = { ...E.freshRecord(), r: 305 };
  E.duel("l", low, "h", high, "h");
  check("floor clamps at 100", low.r === 100);
}

// --- matchmaking ---
{
  const pool = Array.from({ length: 30 }, (_, i) => ({ id: "g" + i, r: 1500, battles: 0 }));
  const rng = E.seededRng(7);
  let ok = true;
  for (let i = 0; i < 200; i++) {
    const p = E.pickPair(pool, [], rng);
    if (!p || p[0] === p[1]) { ok = false; break; }
  }
  check("pairs are two distinct pool members", ok);
}
{
  const pool = [
    { id: "a", r: 1500, battles: 0 },
    { id: "near", r: 1510, battles: 0 },
    { id: "far", r: 1900, battles: 0 },
  ];
  const p = E.pickPair(pool, [], E.seededRng(1), "a");
  check("forced game + close opponent", p && p.includes("a") && p.includes("near"));
}

// --- sprites ---
{
  const g = E.spriteGrid(E.hash("pac-man"));
  check("sprite 7x7", g.length === 7 && g.every((row) => row.length === 7));
  let mirror = true;
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (g[y][x] !== g[y][6 - x]) mirror = false;
  check("sprite mirrors horizontally", mirror);
  check("sprite deterministic", JSON.stringify(g) === JSON.stringify(E.spriteGrid(E.hash("pac-man"))));
  check("sprite has eyes", g[2][2] === 3 && g[2][4] === 3);
  let allGood = true;
  for (let i = 0; i < 500; i++) {
    const f = E.spriteGrid((i * 2654435761) >>> 0).flat();
    const empty = f.filter((v) => v === 0).length;
    if (empty < 8 || empty > 28) allGood = false;
    if (f.filter((v) => v !== 0).length < 18) allGood = false;
  }
  check("sprites stay balanced across seeds", allGood);
  // accessories vary across games but stay deterministic
  const shapes = new Set();
  for (let i = 0; i < 40; i++) shapes.add(JSON.stringify(E.spriteGrid(i * 7919 + 3)));
  check("sprites vary", shapes.size > 30);
}

// --- tournaments ---
check("seed slots n=8", JSON.stringify(E.seedSlots(8)) === JSON.stringify([1, 8, 4, 5, 2, 7, 3, 6]));
check("seed slots n=4", JSON.stringify(E.seedSlots(4)) === JSON.stringify([1, 4, 2, 3]));
check("seed slots n=16 first four", JSON.stringify(E.seedSlots(16).slice(0, 4)) === JSON.stringify([1, 16, 8, 9]));
{
  const ids = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8"];
  const b = E.createBracket(ids);
  check("bracket round count", b.rounds.length === 3);
  check("first round pairs seeded", b.rounds[0][0].a === "g1" && b.rounds[0][0].b === "g8" && b.rounds[0][1].a === "g4" && b.rounds[0][1].b === "g5");
  check("no champion yet", E.championOf(b) === null);
  const nm = E.nextMatch(b);
  check("next match is r0m0", nm && nm.r === 0 && nm.m === 0);

  E.pickWinner(b, 0, 0, "g1");
  check("winner recorded", b.rounds[0][0].winner === "g1");
  check("winner propagates to next round", b.rounds[1][0].a === "g1" && b.rounds[1][0].b === null);
  check("cannot re-pick a decided match", E.pickWinner(b, 0, 0, "g8") === false);
  check("cannot pick a non-participant", E.pickWinner(b, 0, 1, "g2") === false);

  E.pickWinner(b, 0, 1, "g4");
  E.pickWinner(b, 0, 2, "g2");
  E.pickWinner(b, 0, 3, "g3");
  check("round 1 filled", b.rounds[1][0].a === "g1" && b.rounds[1][0].b === "g4" && b.rounds[1][1].a === "g2" && b.rounds[1][1].b === "g3");
  E.pickWinner(b, 1, 0, "g4");
  E.pickWinner(b, 1, 1, "g2");
  check("final filled", b.rounds[2][0].a === "g4" && b.rounds[2][0].b === "g2");
  check("next match points at final", E.nextMatch(b).r === 2 && E.nextMatch(b).m === 0);
  E.pickWinner(b, 2, 0, "g2");
  check("champion crowned", E.championOf(b) === "g2");
  check("bracket complete", E.nextMatch(b) === null);
}

// --- placement ---
{
  const list = Array.from({ length: 100 }, (_, i) => "g" + i); // best first
  const st = E.placementNew(list, "cand");
  let steps = 0;
  let guard = 0;
  let final = null;
  while (guard++ < 50) {
    const s = E.placementStep(st);
    if (s.done) { final = s; break; }
    E.placementAnswer(st, steps % 3 === 0); // pseudo-random answers
    steps++;
  }
  check("placement converges", final && final.done);
  check("placement steps ~log2(n)", steps >= 6 && steps <= 7);
  check("insert position in range", final.insertAt >= 0 && final.insertAt <= list.length);
}
{
  const st = E.placementNew(["a", "b"], "c");
  const s1 = E.placementStep(st); // mid = a
  check("placement first opponent is middle", s1.oppId === "a" || s1.oppId === "b");
  E.placementAnswer(st, true); // candidate better -> above
  const s2 = E.placementStep(st);
  check("placement done after log2(2)", s2.done && s2.insertAt === 0);
}

// --- tiers ---
check("tier S at top", E.tierForIndex(0, 100) === "S");
check("tier D at bottom", E.tierForIndex(99, 100) === "D");
check("tier C mid-low", E.tierForIndex(60, 100) === "C");
{
  const order = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const tiers = E.computeTiers(order);
  check("tiers cover rated games", Object.keys(tiers).length === 10);
  check("tier of first is S", tiers.a === "S");
}

// --- stats ---
{
  const recs = { a: E.freshRecord(), b: E.freshRecord(), c: E.freshRecord() };
  const battles = [
    { a: "a", b: "b", winner: "a", mode: "quick", preA: { ...recs.a }, preB: { ...recs.b } },
    { a: "a", b: "b", winner: "a", mode: "quick", preA: { ...recs.a }, preB: { ...recs.b } },
    { a: "b", b: "c", winner: "b", mode: "quick", preA: { ...recs.b }, preB: { r: 1700, w: 0, l: 0 } },
  ];
  const s = E.ladderStats(recs, battles);
  check("duels counted", s.duels === 3);
  check("current streak a = W2", s.currentStreaks.a.type === "W" && s.currentStreaks.a.n === 2);
  check("longest streak found", s.longestStreak.id === "a" && s.longestStreak.n === 2);
  check("upset detected", s.biggestUpset.winner === "b" && s.biggestUpset.loser === "c" && s.biggestUpset.gap === 200);
  check("rivalry a-b", s.rivalry.a === "a" && s.rivalry.b === "b" && s.rivalry.matches === 2 && s.rivalry.aWins === 2);
  check("most duelled", s.mostDueled.id === "a" || s.mostDueled.id === "b");
}
{
  const h2h = E.headToHead([
    { a: "x", b: "y", winner: "x" },
    { a: "x", b: "y", winner: "y" },
    { a: "x", b: "z", winner: "x" },
  ], "x");
  check("h2h groups by opponent", h2h.length === 2);
  check("h2h counts", h2h[0].opp === "y" && h2h[0].wins === 1 && h2h[0].losses === 1);
}

// --- charts ---
{
  const h = E.histogram([1500, 1502, 1510, 1549, 1551], 25);
  check("histogram bin count", h.bins.length === 3);
  check("histogram counts", h.bins[0] === 3 && h.bins[1] === 1 && h.bins[2] === 1);
  check("histogram empty input", E.histogram([], 25).bins.length === 0);
}

// --- migration ---
{
  const ladder = E.migrateV1({
    recs: { "pac-man": { r: 1520, w: 1, l: 0, hist: [1500, 1520] } },
    battles: [{ a: "pac-man", b: "pong", winner: "pac-man", preA: { r: 1500, w: 0, l: 0, hist: [1500] }, preB: { r: 1500, w: 0, l: 0, hist: [1500] } }],
  });
  check("migrate keeps recs", ladder.recs["pac-man"].r === 1520);
  check("migrate tags battles quick", ladder.battles[0].mode === "quick");
  check("migrate rejects junk", E.migrateV1(null) === null && E.migrateV1({}) === null);
}

// --- replay & merge (multi-device ladder sync) ---
{
  const r = E.replayBattles([]);
  check("replay empty", Object.keys(r.recs).length === 0 && r.battles.length === 0);
}
{
  // Two paths to the same ladder: live duels on records vs replay from the
  // battle log. They must agree exactly — sync merges rely on it.
  const battles = [];
  const live = {};
  const rec = (id) => live[id] || (live[id] = E.freshRecord());
  const duel = (a, b, winner, ts) => {
    battles.push({ a, b, winner, mode: "quick", ts });
    E.duel(a, rec(a), b, rec(b), winner);
  };
  duel("a", "b", "a", 1000);
  duel("a", "c", "a", 2000);
  duel("c", "b", "b", 3000);
  const { recs, battles: out } = E.replayBattles(battles);
  check("replay matches live records", ["a", "b", "c"].every((id) =>
    recs[id].r === live[id].r && recs[id].w === live[id].w && recs[id].l === live[id].l &&
    JSON.stringify(recs[id].hist) === JSON.stringify(live[id].hist)));
  check("replay regenerates pre snapshots", out[1].preA.r === 1520 && out[2].preB.r === 1480);
  check("replay keeps battle order", out.map((b) => b.ts).join(",") === "1000,2000,3000");
}
{
  const { recs } = E.replayBattles([battle("a", "b", "a", 1000)]);
  check("replay single even duel is +20/-20", recs.a.r === 1520 && recs.b.r === 1480 && recs.a.w === 1 && recs.b.l === 1);
}
{
  const r = E.replayBattles([
    { a: "a", b: "b", winner: "a", ts: 5 },
    { a: "x", b: "b", winner: "z", ts: 4 },      // winner is not a participant
    { b: "b", winner: "b", ts: 3 },              // missing a
    null,
  ]);
  check("replay drops invalid battles", r.battles.length === 1 && r.battles[0].a === "a");
  check("replay skips records for invalid battles", r.recs.x === undefined && r.recs.a !== undefined);
}
{
  const r = E.replayBattles([
    { a: "a", b: "b", winner: "b", ts: 200 },
    { a: "a", b: "b", winner: "a", ts: 100 },
  ]);
  check("replay sorts by timestamp", r.battles[0].ts === 100 && r.battles[0].winner === "a");
}
function battle(a, b, winner, ts) {
  return { a, b, winner, mode: "quick", ts, preA: null, preB: null };
}
function storeWith(ladder, extras) {
  return {
    version: 2, active: ladder.id, seen: true, prefs: { muted: false },
    ladders: { [ladder.id]: ladder },
    ...extras,
  };
}
{
  const local = storeWith({ id: "l1", name: "Mine", recs: {}, battles: [battle("a", "b", "a", 100)], tournaments: [], currentTournament: null, unplayed: { z: 1 } });
  const remote = storeWith({ id: "l2", name: "Theirs", recs: {}, battles: [battle("c", "d", "c", 200)], tournaments: [], currentTournament: null, unplayed: { y: 1 } });
  const m = E.mergeStores(local, remote);
  check("merge unions ladders", m && m.ladders.l1 && m.ladders.l2);
  check("merge keeps local active", m.active === "l1");
  check("merge unions unplayed", m.ladders.l1.unplayed.z === 1 && m.ladders.l2.unplayed.y === 1);
  check("onboarding done if either side saw the app", (() => {
    const fresh = { version: 2, active: null, ladders: {}, prefs: {}, seen: false };
    return E.mergeStores(fresh, remote).seen === true && E.mergeStores(fresh, fresh).seen === false;
  })());
}
{
  const shared = battle("a", "b", "a", 100);
  const local = storeWith({ id: "l1", name: "Local name", recs: {}, battles: [shared, battle("a", "c", "a", 300)], tournaments: [{ size: 8, champion: "a", when: 900 }], currentTournament: null });
  const remote = storeWith({ id: "l1", name: "Remote name", recs: { junk: 1 }, battles: [shared, battle("b", "d", "b", 200)], tournaments: [{ size: 8, champion: "a", when: 900 }], currentTournament: null });
  const m = E.mergeStores(local, remote);
  check("merge dedupes identical battles", m.ladders.l1.battles.length === 3);
  check("merge orders by ts", m.ladders.l1.battles.map((b) => b.ts).join(",") === "100,200,300");
  check("merge replays records", m.ladders.l1.recs.a && m.ladders.l1.recs.a.w === 2 && m.ladders.l1.recs.junk === undefined);
  check("merge name from richer side", m.ladders.l1.name === "Local name");
  check("merge dedupes tournaments by when", m.ladders.l1.tournaments.length === 1);
}
{
  const local = storeWith({ id: "l1", name: "A", recs: {}, battles: [], tournaments: [], currentTournament: { size: 8, seeds: {}, bracket: null } });
  const remote = storeWith({ id: "l1", name: "B", recs: {}, battles: [battle("a", "b", "a", 1)], tournaments: [], currentTournament: null });
  const m = E.mergeStores(local, remote);
  check("merge name flips to remote when it has the duels", m.ladders.l1.name === "B");
  check("merge keeps an in-progress local tournament", m.ladders.l1.currentTournament && m.ladders.l1.currentTournament.size === 8);
  check("merge falls back to a surviving active when local one is corrupt", (() => {
    const s = storeWith({ id: "l9", name: "kept", recs: {}, battles: [], tournaments: [], currentTournament: null });
    s.active = "l-nope";
    return E.mergeStores(s, remote).active === "l1";
  })());
  check("merge lands on the duelled ladder from an empty active", (() => {
    const fresh = storeWith({ id: "lnew", name: "Fresh", recs: {}, battles: [], tournaments: [], currentTournament: null });
    return E.mergeStores(fresh, remote).active === "l1";
  })());
}
{
  const local = storeWith({ id: "l1", name: "A", recs: {}, battles: [battle("a", "b", "a", 100)], tournaments: [], currentTournament: null });
  const snapshot = JSON.stringify(local);
  E.mergeStores(local, storeWith({ id: "l1", name: "B", recs: {}, battles: [battle("c", "d", "c", 200)], tournaments: [], currentTournament: null }));
  check("merge does not mutate inputs", JSON.stringify(local) === snapshot);
  check("merge rejects junk remote", E.mergeStores(local, null) === null && E.mergeStores(local, { version: 1, ladders: {} }) === null);
}

// --- roster sanity (browser shim) ---
{
  global.window = {};
  require("./games.js");
  const games = global.window.GAMES;
  check("roster size sane", games.length >= 100);
  const ids = new Set(games.map((g) => g.id));
  check("roster ids unique", ids.size === games.length);
  const genres = new Set(games.flatMap((g) => g.genres));
  check("genres are arrays", games.every((g) => Array.isArray(g.genres) && g.genres.length >= 1));
  check("platforms are arrays", games.every((g) => Array.isArray(g.platforms) && g.platforms.length >= 1));
  check("fields complete", games.every((g) => g.title && g.year >= 1970 && g.year <= 2026 && g.dev));
}

console.log(failures === 0 ? "\nAll engine tests passed." : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
