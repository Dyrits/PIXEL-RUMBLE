#!/usr/bin/env node
// Pixel Rumble cover pipeline: box art for every game on the roster.
//
// Reads games.js, and for every "steam-<appid>" entry downloads both art
// variants from Steam's public CDN into covers/:
//
//   <appid>.jpg     portrait library art  (duel cards, champion box, thumbs)
//   <appid>.h.jpg   landscape header art  (game detail modal banner)
//
// It then writes covers.js — a manifest the app consults at render time,
// recording each file's true pixel size (read from the JPEG itself). Games
// whose art cannot be fetched (and curated entries without an appid) keep
// their generated pixel sprite, which is the app's built-in fallback.
//
//   node fetch-covers.js            # fetch missing variants, rewrite manifest
//   node fetch-covers.js --force    # re-download even if the file exists
//
// Already-downloaded files are skipped, so re-runs are incremental; delete
// covers/ to start over. These are the same CDN assets the Steam store loads
// (not the rate-limited store API), but keep the concurrency modest anyway.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROSTER = path.join(ROOT, "games.js");
const COVERS_DIR = path.join(ROOT, "covers");
const OUT = path.join(ROOT, "covers.js");
const META = path.join(ROOT, ".cache-data", "covers-meta.json");

const CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps";
const CONCURRENCY = 6;

const argv = process.argv.slice(2);
const FORCE = argv.includes("--force");

const log = (...a) => console.error("[covers]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadRoster() {
  const src = await readFile(ROSTER, "utf8");
  const sandbox = { window: {} };
  new Function("window", src)(sandbox.window);
  const games = sandbox.window.GAMES || [];
  if (!games.length) throw new Error("games.js has no GAMES roster");
  return games;
}

// JPEG dimension reader: walk the segment markers to the first SOF frame
// (baseline or progressive) and read its height/width. ~30 lines instead of
// an image dependency, and it keeps the manifest truthful about what the CDN
// actually served (the "600x900" URL is not always 600x900).
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

async function fetchAsset(appid, file) {
  const res = await fetch(`${CDN}/${appid}/${file}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4096) return null; // CDN error pages are not covers
  return buf;
}

async function main() {
  const games = await loadRoster();
  const targets = games
    .map((g) => ({ id: g.id, appid: (g.id.match(/^steam-(\d+)$/) || [])[1] }))
    .filter((t) => t.appid);
  log(`roster: ${games.length} games, ${targets.length} with a Steam appid`);

  await mkdir(COVERS_DIR, { recursive: true });
  // Saved variants per appid, so re-runs can rebuild the manifest without
  // re-downloading. { "<appid>": { p: [w, h], h: [w, h] } }
  let meta = {};
  if (existsSync(META)) {
    try {
      meta = JSON.parse(await readFile(META, "utf8"));
    } catch {
      /* corrupt cache entry: refetch what is missing */
    }
  }
  // v1 of this pipeline stored the portrait under a bare "<appid>.jpg" with
  // only variant-level dims; treat those files as present but unknown size.
  for (const t of targets) {
    if (existsSync(path.join(COVERS_DIR, `${t.appid}.jpg`)) && !meta[t.appid]?.p) {
      meta[t.appid] = meta[t.appid] || {};
      if (!meta[t.appid].p) meta[t.appid].p = "measure";
    }
  }

  const manifest = {};
  let fetched = 0;
  let kept = 0;
  let missed = 0;
  const misses = [];

  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const t = targets[cursor++];
      const entry = {};
      for (const [variant, file, cdnFile] of [
        ["p", `${t.appid}.jpg`, "library_600x900.jpg"],
        ["h", `${t.appid}.h.jpg`, "header.jpg"],
      ]) {
        const fileAbs = path.join(COVERS_DIR, file);
        const known = meta[t.appid]?.[variant];
        if (!FORCE && existsSync(fileAbs) && Array.isArray(known)) {
          entry[variant] = [`covers/${file}`, known[0], known[1]];
          continue;
        }
        try {
          let buf = null;
          if (!FORCE && known === "measure" && existsSync(fileAbs)) {
            buf = await readFile(fileAbs); // v1 file: measure it in place
          } else if (FORCE || !existsSync(fileAbs)) {
            buf = await fetchAsset(t.appid, cdnFile);
            if (buf) await writeFile(fileAbs, buf);
          }
          const size = buf ? jpegSize(buf) : null;
          if (size) {
            meta[t.appid] = meta[t.appid] || {};
            meta[t.appid][variant] = [size.w, size.h];
            entry[variant] = [`covers/${file}`, size.w, size.h];
          }
        } catch (err) {
          log(`${t.id}/${variant}: ${err.message}`);
        }
        await sleep(150); // stay polite to the CDN
      }
      if (entry.p || entry.h) {
        manifest[t.id] = entry;
        if (entry.p && entry.h) kept++;
        else fetched++;
      } else {
        missed++;
        misses.push(t.id);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await mkdir(path.dirname(META), { recursive: true });
  await writeFile(META, JSON.stringify(meta));

  const ids = Object.keys(manifest).sort();
  const header = `// Pixel Rumble cover manifest. GENERATED by fetch-covers.js on ${new Date().toISOString()}
// from Steam's public CDN. Two variants per game: p = portrait library art,
// h = landscape header. Values are [src, width, height]; a missing variant
// (or a missing game) renders the other variant or the pixel sprite.
`;
  const body = ids
    .map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(manifest[id])},`)
    .join("\n");
  await writeFile(OUT, `${header}window.COVERS = {\n${body}\n};\n`);

  const withBoth = ids.filter((id) => manifest[id].p && manifest[id].h).length;
  log(`covers: ${withBoth} both variants, ${ids.length - withBoth} partial, ${missed} missing`);
  log(`wrote ${ids.length} entries -> ${path.relative(ROOT, OUT)}`);
  if (misses.length) log("missing (sprite fallback):", misses.join(" "));
}

main().catch((err) => {
  console.error("[covers] failed:", err);
  process.exit(1);
});
