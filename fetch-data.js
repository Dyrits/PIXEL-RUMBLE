#!/usr/bin/env node
// Pixel Rumble roster pipeline: regenerates games.js from public APIs.
//
// Two keyless sources, joined exactly on the Steam application ID:
//
//   SteamSpy  steamspy.com/api.php          catalog ordered by owners, with
//                                           review tallies and developers
//   Wikidata  query.wikidata.org/sparql     release dates, genres, platforms
//                                           (join key: P1733, the Steam appid)
//
// The Wikidata join doubles as a notability filter: only games with a curated
// knowledge-base entry survive, which keeps shovelware out without anyone
// hand-picking titles. Selection is then water-filled across decades so the
// roster spans eras instead of collapsing onto whatever shipped last year.
//
//   node fetch-data.js                          # 160 games, API only
//   node fetch-data.js --limit 240 --pages 6    # bigger roster, deeper crawl
//   node fetch-data.js --with-curated           # merge the 147 classics in
//                                                 data/games-curated.js
//
// Raw responses are cached in .cache-data/, so re-runs are free and an
// interrupted crawl resumes where it left off. SteamSpy allows ~1 req/s and
// Wikidata is a shared endpoint: the delays below are deliberate.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "games.js");
const CURATED = path.join(ROOT, "data", "games-curated.js");
const CACHE = path.join(ROOT, ".cache-data");

const UA =
  process.env.WIKIDATA_USER_AGENT ??
  "PixelRumble/2.0 (local roster pipeline; set WIKIDATA_USER_AGENT to identify yourself)";

const argv = process.argv.slice(2);
const num = (flag, dflt) => {
  const i = argv.indexOf(`--${flag}`);
  return i >= 0 && argv[i + 1] != null && Number.isFinite(Number(argv[i + 1])) ? Number(argv[i + 1]) : dflt;
};
const PAGES = num("pages", 4); // SteamSpy pages of 1000, ordered by owners
const LIMIT = num("limit", 160);
const MIN_REVIEWS = num("min-reviews", 200); // below this a review share is noise
const WITH_CURATED = argv.includes("--with-curated");
const BATCH = 200; // appids per Wikidata query; 500 gets rejected

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[fetch]", ...a);

async function getJSON(url, { headers = {}, tries = 4, label = "" } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      if (res.ok) return await res.json();
      if (res.status < 500 && res.status !== 429) throw new Error(`${label} HTTP ${res.status}`);
      log(`${label} HTTP ${res.status}, retrying`);
    } catch (err) {
      if (attempt === tries - 1) throw err;
      if (err.name === "AbortError") log(`${label} timed out, retrying`);
    }
    await sleep(1000 * 2 ** attempt);
  }
  throw new Error(`${label}: exhausted retries`);
}

async function cached(name, produce) {
  const file = path.join(CACHE, `${name}.json`);
  if (existsSync(file)) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      /* corrupt cache entry: fall through and refetch */
    }
  }
  const value = await produce();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(value));
  return value;
}

/* ---------------------------------------------------------------- SteamSpy */

async function fetchCatalog() {
  const games = new Map();
  for (let page = 0; page < PAGES; page++) {
    const rows = await cached(`spy-${page}`, async () => {
      log(`steamspy page ${page + 1}/${PAGES}`);
      const data = await getJSON(`https://steamspy.com/api.php?request=all&page=${page}`, {
        headers: { "User-Agent": UA },
        label: `steamspy page ${page}`,
      });
      await sleep(1100); // SteamSpy allows one request per second
      return Object.values(data);
    });
    if (!rows.length) break;
    for (const row of rows) games.set(row.appid, row);
  }
  return [...games.values()];
}

/* ---------------------------------------------------------------- Wikidata */

// Map Wikidata's long genre tail onto Pixel Rumble's fixed taxonomy so filter
// chips, tier colors and sprite palettes stay coherent. First match wins, so
// the specific patterns come before the generic ones.
const GENRE_RULES = [
  [/survival horror/i, "Horror"],
  [/battle royale/i, "Shooter"],
  [/multiplayer online battle arena|\bmoba\b/i, "Strategy"],
  [/massively multiplayer|\bmmo\b/i, "RPG"],
  [/rogue-like|roguelike|rogue-lite/i, "Roguelike"],
  [/tower defense/i, "Strategy"],
  [/real-time strategy|turn-based strategy|grand strategy|\b4x\b/i, "Strategy"],
  [/first-person shooter|third-person shooter|shoot ?'?em up/i, "Shooter"],
  [/role-playing|\brpg\b/i, "RPG"],
  [/platform/i, "Platformer"],
  [/fighting/i, "Fighting"],
  [/racing|vehicle simulation/i, "Racing"],
  [/sports/i, "Sports"],
  [/rhythm|music game/i, "Puzzle"],
  [/visual novel|dating sim/i, "Adventure"],
  [/hack and slash|beat ?'em up|action-adventure/i, "Action-Adventure"],
  [/adventure/i, "Adventure"],
  [/puzzle/i, "Puzzle"],
  [/sandbox|open world/i, "Sandbox"],
  [/city-building|life simulation|economic simulation|god game|simulation/i, "Simulation"],
  [/card game|board game/i, "Puzzle"],
  [/arcade/i, "Arcade"],
  [/shooter/i, "Shooter"],
  [/horror/i, "Horror"],
  [/action/i, "Action"],
  [/strategy/i, "Strategy"],
];

// Platform services that are not hardware, and long names that would
// substring-collide with shorter ones are handled by matching each source
// value against at most one rule (first match wins) below.
const PLATFORM_SKIPS =
  /playstation network|\bpsn\b|steam deck|virtual reality|\bvr\b|oculus|mixed reality|google stadium|stadia/i;

const PLATFORM_RULES = [
  [/windows|\bpc\b|ibm pc compatible|ms-dos|\bdos\b/i, "PC"], // the roster's home platform leads
  [/playstation 5|\bps5\b/i, "PS5"],
  [/playstation 4|\bps4\b/i, "PS4"],
  [/playstation 3|\bps3\b/i, "PS3"],
  [/playstation 2|\bps2\b/i, "PS2"],
  [/playstation portable|\bpsp\b/i, "PSP"],
  [/playstation vita|\bvita\b/i, "Vita"],
  [/playstation/i, "PS1"],
  [/xbox series/i, "Xbox Series"],
  [/xbox one/i, "Xbox One"],
  [/xbox 360/i, "Xbox 360"],
  [/xbox/i, "Xbox"],
  [/nintendo switch|\bswitch\b/i, "Switch"],
  [/wii u/i, "Wii U"],
  [/wii/i, "Wii"],
  [/gamecube/i, "GC"],
  [/nintendo 64|\bn64\b/i, "N64"],
  [/super nintendo|\bsnes\b/i, "SNES"],
  [/nintendo entertainment system|\bnes\b/i, "NES"],
  [/nintendo 3ds/i, "3DS"],
  [/nintendo ds|\bnds\b/i, "DS"],
  [/game boy advance|\bgba\b/i, "GBA"],
  [/game boy/i, "GB"],
  [/macintosh|macos|os x|\bmac\b/i, "Mac"],
  [/linux/i, "Linux"],
  [/android/i, "Android"],
  [/ios|iphone|ipad/i, "iOS"],
];

// Each source value maps to at most one label (its first matching rule), so
// "Super Nintendo Entertainment System" cannot also register as NES. Labels
// are then emitted in rule-priority order, which keeps the primary genre (the
// sprite palette anchor) the most specific one available.
function bucketAll(rules, values) {
  const hits = values
    .filter((v) => !PLATFORM_SKIPS.test(v))
    .map((v) => {
      for (const [re, label] of rules) if (re.test(v)) return label;
      return null;
    });
  const out = [];
  for (const [, label] of rules) {
    if (hits.includes(label) && !out.includes(label)) out.push(label);
  }
  return out;
}

function batchQuery(appIds, full) {
  const values = appIds.map((id) => `"${id}"`).join(" ");
  const facets = full
    ? `
    OPTIONAL { ?g wdt:P136 ?genre. ?genre rdfs:label ?gl. FILTER(LANG(?gl) = "en") }
    OPTIONAL { ?g wdt:P400 ?plat. ?plat rdfs:label ?pl. FILTER(LANG(?pl) = "en") }`
    : "";
  return `SELECT ?sid ?label ?date ?gl ?pl WHERE {
    VALUES ?sid { ${values} }
    ?g wdt:P1733 ?sid.
    OPTIONAL { ?g rdfs:label ?label. FILTER(LANG(?label) = "en") }
    OPTIONAL { ?g wdt:P577 ?date. }${facets}
  } LIMIT 20000`;
}

async function fetchWikidata(appIds, full) {
  const out = new Map();
  let done = 0;
  for (let i = 0; i < appIds.length; i += BATCH) {
    const chunk = appIds.slice(i, i + BATCH);
    const key = `wd-${full ? "full" : "core"}-${chunk[0]}-${chunk[chunk.length - 1]}-${chunk.length}`;
    const rows = await cached(key, async () => {
      const url =
        "https://query.wikidata.org/sparql?format=json&query=" +
        encodeURIComponent(batchQuery(chunk, full));
      const data = await getJSON(url, {
        headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
        tries: 5,
        label: `wikidata ${key}`,
      });
      await sleep(350); // shared public endpoint
      return data.results.bindings;
    });

    for (const row of rows) {
      const sid = row.sid.value;
      const entry = out.get(sid) ?? { genres: new Set(), platforms: new Set() };
      // Regional release dates: the earliest one is the original release.
      const iso = row.date?.value;
      if (iso && (!entry.date || iso < entry.date)) entry.date = iso;
      entry.label = row.label?.value ?? entry.label;
      if (row.gl?.value) entry.genres.add(row.gl.value);
      if (row.pl?.value) entry.platforms.add(row.pl.value);
      out.set(sid, entry);
    }

    done += chunk.length;
    if (done % 1000 === 0) log(`wikidata ${done}/${appIds.length}`);
  }
  return out;
}

/* ------------------------------------------------------------------ select */

// Round-robin across decades, best-reviewed first, so 1985 and 2024 both get
// slots instead of the newest decade eating the whole limit.
function balanceAcrossDecades(pool, limit) {
  const byDecade = new Map();
  for (const g of pool) {
    const decade = Math.floor(g.year / 10) * 10;
    if (!byDecade.has(decade)) byDecade.set(decade, []);
    byDecade.get(decade).push(g);
  }
  for (const list of byDecade.values()) {
    list.sort((a, b) => b.game.positive - a.game.positive);
  }
  const decades = [...byDecade.values()];
  const chosen = [];
  let progress = true;
  while (chosen.length < limit && progress) {
    progress = false;
    for (const list of decades) {
      if (chosen.length >= limit) break;
      const next = list.shift();
      if (next) {
        chosen.push(next);
        progress = true;
      }
    }
  }
  return chosen;
}

/* ------------------------------------------------------------------- main */

function toEntry({ game, year }) {
  const title = String(game.name).replace(/[™®©]/g, "").trim();
  const dev = game.developer && game.developer !== ""
    ? game.developer.split(",")[0].trim()
    : "Unknown studio";
  return {
    id: `steam-${game.appid}`,
    title,
    year,
    genres: null, // filled by caller from Wikidata facets
    platforms: null,
    dev,
  };
}

async function main() {
  const catalog = await fetchCatalog();
  log(`catalog: ${catalog.length} games`);

  const candidates = catalog.filter((g) => g.positive + g.negative >= MIN_REVIEWS);
  log(`candidates with >= ${MIN_REVIEWS} reviews: ${candidates.length}`);

  // Pass 1: dates for every candidate.
  const dated = await fetchWikidata(candidates.map((g) => String(g.appid)), false);
  log(`pass 1 (dates) matched: ${dated.size}`);

  const currentYear = new Date().getUTCFullYear();
  const pool = [];
  for (const g of candidates) {
    const iso = dated.get(String(g.appid))?.date;
    if (!iso) continue;
    const year = Number(iso.slice(0, 4));
    if (!Number.isFinite(year) || year < 1970 || year > currentYear) continue;
    pool.push({ game: g, year });
  }
  log(`dated pool: ${pool.length}`);

  // Curated classics take their slots first (deduped by title later).
  let games = [];
  let apiBudget = LIMIT;
  if (WITH_CURATED) {
    const curated = await loadCurated();
    games.push(...curated);
    log(`curated classics: ${curated.length}`);
    apiBudget = Math.max(0, LIMIT - curated.length);
  }

  const chosen = balanceAcrossDecades(pool, apiBudget + 40); // headroom for dedupe
  log(`selected from API: ${chosen.length} (before dedupe)`);

  // Pass 2: genres and platforms for the chosen games only.
  const full = await fetchWikidata(chosen.map((c) => String(c.game.appid)), true);
  log(`pass 2 (facets) matched: ${full.size}`);

  const seenTitles = new Set(games.map((g) => normalize(g.title)));
  let added = 0;
  for (const c of chosen) {
    if (added >= apiBudget) break;
    const entry = toEntry(c);
    const norm = normalize(entry.title);
    if (seenTitles.has(norm)) continue;
    seenTitles.add(norm);
    const f = full.get(String(c.game.appid));
    entry.genres = bucketAll(GENRE_RULES, f ? [...f.genres] : []);
    if (!entry.genres.length) entry.genres = ["Action"];
    entry.platforms = bucketAll(PLATFORM_RULES, f ? [...f.platforms] : []);
    if (!entry.platforms.length) entry.platforms = ["PC"];
    entry.platforms = entry.platforms.slice(0, 4);
    games.push(entry);
    added++;
  }

  games.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
  log(`roster: ${games.length} games (${added} from the API)`);

  const header = `// Pixel Rumble roster. GENERATED by fetch-data.js on ${new Date().toISOString()}
// from SteamSpy (catalog, developers) and Wikidata (release dates, genres,
// platforms) joined on the Steam application ID. Re-run the pipeline to
// refresh; see data/games-curated.js for the hand-picked fallback set.
`;
  const body = games
    .map((g) => JSON.stringify(g))
    .map((s) => `  ${s},`)
    .join("\n");
  await writeFile(OUT, `${header}window.GAMES = [\n${body}\n];\n`);

  const years = games.map((g) => g.year);
  const byDecade = {};
  for (const y of years) byDecade[`${Math.floor(y / 10) * 10}s`] = (byDecade[`${Math.floor(y / 10) * 10}s`] ?? 0) + 1;
  log(`wrote ${games.length} games -> ${path.relative(ROOT, OUT)}`);
  log(`years ${Math.min(...years)}-${Math.max(...years)}`);
  log("by decade: " + Object.entries(byDecade).sort().map(([k, v]) => `${k}:${v}`).join(" "));
}

function normalize(title) {
  return title.toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[^a-z0-9]+/g, "");
}

async function loadCurated() {
  if (!existsSync(CURATED)) return [];
  const src = await readFile(CURATED, "utf8");
  const sandbox = { window: {} };
  new Function("window", src)(sandbox.window);
  return sandbox.window.GAMES_CURATED || [];
}

main().catch((err) => {
  console.error("[fetch] failed:", err);
  process.exit(1);
});
