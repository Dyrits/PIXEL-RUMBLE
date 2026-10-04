// Node smoke tests for engine.js. Run: node engine.test.js
const E = require("./engine.js");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`ok  ${name}`);
  else { failures++; console.error(`FAIL ${name}`); }
}

// --- expected score ---
check("even match expected 0.5", Math.abs(E.expected(1500, 1500) - 0.5) < 1e-9);
check("+200 favorite ~0.76", Math.abs(E.expected(1700, 1500) - 0.760) < 0.001);
check("underdog ~0.24", Math.abs(E.expected(1500, 1700) - 0.240) < 0.001);

// --- k factor ---
check("newcomer K=40", E.kFactor(0) === 40 && E.kFactor(4) === 40);
check("rising K=32", E.kFactor(5) === 32 && E.kFactor(14) === 32);
check("veteran K=24", E.kFactor(15) === 24);

// --- duel: fresh records, equal ratings ---
{
  const a = E.freshRecord();
  const b = E.freshRecord();
  const { deltaA, deltaB } = E.duel("a", a, "b", b, "a");
  check("even duel moves +20", deltaA === 20 && deltaB === -20);
  check("winner record 1520/1-0", a.r === 1520 && a.w === 1 && a.l === 0);
  check("loser record 1480/0-1", b.r === 1480 && b.w === 0 && b.l === 1);
  check("history pushed", a.hist.length === 2 && a.hist[1] === 1520);
}

// --- duel: favorite wins less, loses more ---
{
  const fav = { ...E.freshRecord(), r: 1800 };
  const dog = { ...E.freshRecord(), r: 1400 };
  const d1 = E.duel("f", fav, "d", dog, "f");
  check("favorite wins small", d1.deltaA > 0 && d1.deltaA < 10);
  const fav2 = { ...E.freshRecord(), r: 1800 };
  const dog2 = { ...E.freshRecord(), r: 1400 };
  const d2 = E.duel("f", fav2, "d", dog2, "d");
  check("upset swings big", d2.deltaA < -20 && d2.deltaB > 25);
}

// --- duel: rating floor ---
{
  const low = { ...E.freshRecord(), r: 110 };
  const high = { ...E.freshRecord(), r: 305 };
  E.duel("l", low, "h", high, "h");
  check("floor clamps at 100", low.r === 100);
}

// --- hash & rng determinism ---
check("hash stable", E.hash("super-metroid") === E.hash("super-metroid"));
check("hash differs per id", E.hash("doom") !== E.hash("doom-2016"));
{
  const r1 = E.seededRng(42);
  const r2 = E.seededRng(42);
  const seq1 = [r1(), r1(), r1()];
  const seq2 = [r2(), r2(), r2()];
  check("rng reproducible", seq1.every((v, i) => v === seq2[i]));
  check("rng in range", seq1.every((v) => v >= 0 && v < 1));
}

// --- pickPair ---
{
  const pool = Array.from({ length: 30 }, (_, i) => ({ id: "g" + i, r: 1500, battles: 0 }));
  const rng = E.seededRng(7);
  let ok = true;
  for (let i = 0; i < 200; i++) {
    const p = E.pickPair(pool, [], rng);
    if (!p || p[0] === p[1]) { ok = false; break; }
    if (!pool.some((g) => g.id === p[0]) || !pool.some((g) => g.id === p[1])) { ok = false; break; }
  }
  check("pairs are two distinct pool members", ok);
}
{
  const pool = Array.from({ length: 12 }, (_, i) => ({ id: "g" + i, r: 1500, battles: 0 }));
  const recent = ["g0", "g1", "g2", "g3"];
  const rng = E.seededRng(9);
  let avoided = true;
  for (let i = 0; i < 100; i++) {
    const p = E.pickPair(pool, recent, rng);
    if (recent.includes(p[0]) && pool.length > recent.length + 2) avoided = false;
  }
  check("recents excluded while pool allows", avoided);
}
{
  const pool = [
    { id: "a", r: 1500, battles: 0 },
    { id: "near", r: 1510, battles: 0 },
    { id: "far", r: 1900, battles: 0 },
  ];
  const p = E.pickPair(pool, [], E.seededRng(1), "a");
  check("forced game included, close opponent chosen", p && p.includes("a") && p.includes("near"));
}
check("pool too small returns null", E.pickPair([{ id: "x", r: 1500, battles: 0 }], [], Math.random) === null);

// --- sprite grid ---
{
  const g = E.spriteGrid(E.hash("pac-man"));
  check("sprite 7x7", g.length === 7 && g.every((row) => row.length === 7));
  let mirror = true;
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) if (g[y][x] !== g[y][6 - x]) mirror = false;
  }
  check("sprite mirrors horizontally", mirror);
  check("sprite deterministic", JSON.stringify(g) === JSON.stringify(E.spriteGrid(E.hash("pac-man"))));
  const flat = g.flat();
  check("sprite has body", flat.filter((v) => v === 1).length >= 8);
  check("sprite has empty space", flat.filter((v) => v === 0).length >= 8);
  // coverage across many sprites: every grid should still read as a figure
  let allGood = true;
  for (let i = 0; i < 200; i++) {
    const s = E.spriteGrid((i * 2654435761) >>> 0);
    const f = s.flat();
    if (f.filter((v) => v === 1).length < 4) allGood = false;
    if (f.filter((v) => v === 0).length < 6) allGood = false;
  }
  check("sprites stay balanced across seeds", allGood);
}

// --- roster sanity (loads via a tiny browser shim) ---
{
  global.window = {};
  require("./games.js");
  const games = global.window.GAMES;
  check("roster size sane", games.length >= 100);
  const ids = new Set(games.map((g) => g.id));
  check("roster ids unique", ids.size === games.length);
  const fieldsOk = games.every((g) => g.id && g.title && g.year >= 1970 && g.year <= 2026 && g.genre && g.platform && g.dev);
  check("roster fields complete", fieldsOk);
}

console.log(failures === 0 ? "\nAll engine tests passed." : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
