// Pixel Rumble V2 core: state, ladders, actions and chrome. The views in
// views.js read everything through the window.PR object defined here.
(function () {
  "use strict";

  const E = window.PixelRumbleEngine;
  const GAMES = window.GAMES;
  const BY_ID = new Map(GAMES.map((g) => [g.id, g]));
  const STORE_KEY = "pixel-rumble.v2";
  const V1_KEY = "pixel-rumble.v1";
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const GENRE_HUE = {
    Arcade: 45, Platformer: 210, RPG: 275, Shooter: 195, Action: 8,
    "Action-Adventure": 135, Fighting: 345, Racing: 25, Puzzle: 310,
    Strategy: 80, Simulation: 160, Horror: 230, Sports: 100,
    Roguelike: 0, Sandbox: 65, Adventure: 175,
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // ---------- store ----------

  function freshStore() {
    return { version: 2, active: null, ladders: {}, prefs: { muted: false }, seen: false };
  }

  let store;
  let toastTimer = null;
  let statsCache = null;
  let tiersCache = null;

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (E.validStore(data)) return data;
      }
    } catch (e) { /* fall through to a fresh store */ }
    return freshStore();
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* private mode: play without persistence */ }
    // Sync (when signed in) rides on every persisted change.
    if (window.PRSync) window.PRSync.onSave();
  }

  // Replaces the whole store (used by sync after merging a remote store) and
  // re-enters the app on the merged state: caches drop, volatile duel state
  // resets, the onboarding gate closes if the merged store has seen the app.
  function replaceStore(next) {
    if (!E.validStore(next)) return false;
    store = next;
    if (!store.ladders[store.active]) store.active = Object.keys(store.ladders)[0] || null;
    if (store.active) ensureRecs(store.ladders[store.active]);
    state.quick.pair = null;
    state.quick.recentIds = [];
    state.placement = null;
    state.lastChampion = null;
    invalidateCaches();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* private mode: play without persistence */ }
    const gate = $("#gate");
    if (gate && store.seen && store.active) {
      gate.hidden = true;
      gate.classList.remove("open");
      gate.textContent = "";
    }
    if (ladder()) render();
    return true;
  }

  function ladder() {
    return store.ladders[store.active] || null;
  }

  function ensureRecs(l) {
    // A regenerated roster can leave battles pointing at games that no longer
    // exist; they are meaningless without their games and would crash the
    // views, so they are dropped when the ladder is loaded.
    const kept = (l.battles || []).filter(
      (b) => BY_ID.has(b.a) && BY_ID.has(b.b) && BY_ID.has(b.winner)
    );
    if (l.battles && kept.length !== l.battles.length) {
      l.battles = kept;
      save();
    }
    for (const g of GAMES) {
      if (!l.recs[g.id]) l.recs[g.id] = E.freshRecord();
    }
  }

  // ---------- volatile view state ----------

  const state = {
    view: "duel",
    duelMode: "quick",
    quick: { pair: null, recentIds: [], filters: { genre: "", era: "" }, locked: false },
    rankFilters: { query: "", genre: "", era: "" },
    tournamentCfg: { size: 8, seeding: "random" },
    placement: null,
    lastChampion: null,
    modalOpenId: null,
    introShown: false,
  };

  const rng = E.seededRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

  // ---------- records & battles ----------

  function recordOf(id) {
    const l = ladder();
    return (l.recs[id] || (l.recs[id] = E.freshRecord()));
  }

  function battles() {
    return ladder().battles;
  }

  function lastBattle() {
    const list = battles();
    return list.length ? list[list.length - 1] : null;
  }

  function applyDuel(aId, bId, winnerId, mode) {
    const l = ladder();
    const recA = recordOf(aId);
    const recB = recordOf(bId);
    const preA = { r: recA.r, w: recA.w, l: recA.l, hist: recA.hist.slice() };
    const preB = { r: recB.r, w: recB.w, l: recB.l, hist: recB.hist.slice() };
    const deltas = E.duel(aId, recA, bId, recB, winnerId);
    l.battles.push({ a: aId, b: bId, winner: winnerId, mode: mode || "quick", ts: Date.now(), preA, preB });
    invalidateCaches();
    save();
    updateChrome();
    return deltas;
  }

  function canUndo() {
    if (state.duelMode !== "quick") return false;
    if (state.placement) return false;
    if (ladder().currentTournament) return false;
    const last = lastBattle();
    return !!last && last.mode === "quick";
  }

  function undoLast() {
    const last = battles().pop();
    if (!last) return;
    ladder().recs[last.a] = last.preA;
    ladder().recs[last.b] = last.preB;
    invalidateCaches();
    save();
    state.quick.pair = [last.a, last.b];
    state.quick.recentIds = [last.a, last.b];
    sound("undo");
    toast("Duel undone");
    updateChrome();
  }

  // ---------- derived data ----------

  function invalidateCaches() {
    statsCache = null;
    tiersCache = null;
  }

  function sortGames() {
    const l = ladder();
    return GAMES.slice().sort((a, b) => {
      const ra = l.recs[a.id] || E.freshRecord();
      const rb = l.recs[b.id] || E.freshRecord();
      if (rb.r !== ra.r) return rb.r - ra.r;
      const ba = ra.w + ra.l;
      const bb = rb.w + rb.l;
      if (bb !== ba) return bb - ba;
      return a.title.localeCompare(b.title);
    }).map((g) => g.id);
  }

  function ratedOrder() {
    const l = ladder();
    return sortGames().filter((id) => {
      const r = l.recs[id];
      return r && r.w + r.l > 0;
    });
  }

  function tiers() {
    if (!tiersCache) tiersCache = E.computeTiers(ratedOrder());
    return tiersCache;
  }

  function stats() {
    if (!statsCache) statsCache = E.ladderStats(ladder().recs, battles());
    return statsCache;
  }

  function streakOf(id) {
    return stats().currentStreaks[id] || null;
  }

  function bestWin(id) {
    let best = null;
    for (const b of battles()) {
      if (b.winner !== id) continue;
      const opp = b.a === id ? b.b : b.a;
      if (!best || recordOf(opp).r > recordOf(best).r) best = opp;
    }
    return best;
  }

  function worstLoss(id) {
    let worst = null;
    for (const b of battles()) {
      if (b.a !== id && b.b !== id) continue;
      if (b.winner === id) continue;
      const opp = b.a === id ? b.b : b.a;
      if (!worst || recordOf(opp).r < recordOf(worst).r) worst = opp;
    }
    return worst;
  }

  function ratingValues() {
    return GAMES.map((g) => recordOf(g.id).r);
  }

  // ---------- quick duel ----------

  function unplayedMap() {
    const l = ladder();
    return l.unplayed || (l.unplayed = {});
  }

  function isUnplayed(id) {
    return Boolean(ladder().unplayed && ladder().unplayed[id]);
  }

  function markUnplayed(ids) {
    const un = unplayedMap();
    for (const id of ids) un[id] = 1;
    save();
  }

  function togglePlayed(id) {
    const un = unplayedMap();
    if (un[id]) delete un[id];
    else un[id] = 1;
    save();
    updateChrome();
  }

  function poolGames() {
    const f = state.quick.filters;
    const un = ladder().unplayed || {};
    const pool = GAMES.filter((g) => {
      if (f.genre && !g.genres.includes(f.genre)) return false;
      if (f.era && String(Math.floor(g.year / 10) * 10) !== f.era) return false;
      return true;
    });
    // Duels the user can't judge are wasted turns, so keep unplayed games out
    // of the pool — unless that would leave no pair, then fall back to all.
    const played = pool.filter((g) => !un[g.id]);
    return played.length >= 2 ? played : pool;
  }

  function nextQuickPair(forcedId) {
    const pool = poolGames().map((g) => {
      const rec = recordOf(g.id);
      return { id: g.id, r: rec.r, battles: rec.w + rec.l };
    });
    state.quick.pair = E.pickPair(pool, state.quick.recentIds, rng, forcedId || null);
    state.quick.recentIds = [...(state.quick.pair || []), ...state.quick.recentIds].slice(0, 4);
  }

  // ---------- tournaments ----------

  function tournaments() {
    return ladder().tournaments;
  }

  function tournamentCurrent() {
    return ladder().currentTournament;
  }

  function startTournament() {
    const cfg = state.tournamentCfg;
    const order = sortGames();
    let ids;
    if (cfg.seeding === "top") {
      ids = order.slice(0, cfg.size);
    } else {
      ids = GAMES.map((g) => g.id);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      ids = ids.slice(0, cfg.size);
    }
    const seeds = {};
    if (cfg.seeding === "top") ids.forEach((id, i) => (seeds[id] = i + 1));
    ladder().currentTournament = {
      size: cfg.size,
      seeding: cfg.seeding,
      seeds,
      bracket: E.createBracket(ids),
      startedAt: Date.now(),
    };
    state.lastChampion = null;
    save();
  }

  function tournamentPick(winnerId, r, m) {
    const t = ladder().currentTournament;
    if (!t) return;
    const match = t.bracket.rounds[r][m];
    if (!match || match.winner) return;
    applyDuel(match.a, match.b, winnerId, "tournament");
    E.pickWinner(t.bracket, r, m, winnerId);
    const champ = E.championOf(t.bracket);
    if (champ) {
      t.bracket = null;
      ladder().currentTournament = null;
      ladder().tournaments.push({ size: t.size, champion: champ, when: Date.now() });
      state.lastChampion = { champion: champ, size: t.size, confettiDone: false };
      sound("champ");
    } else {
      sound("match");
    }
    save();
  }

  function abandonTournament() {
    ladder().currentTournament = null;
    state.lastChampion = null;
    save();
  }

  function seedOf(id) {
    const t = tournamentCurrent();
    if (!t || t.seeding !== "top") return "";
    return t.seeds[id] ? String(t.seeds[id]) : "";
  }

  // ---------- placement ----------

  function startPlacement(id) {
    const others = sortGames().filter((x) => x !== id);
    state.placement = { st: E.placementNew(others, id), done: null };
  }

  // ---------- art ----------

  // Real cover art where the pipeline found it: covers.js maps game ids to
  // { p: [src, w, h], h: [src, w, h] } — portrait library art and landscape
  // header art. Everything else (and any missing file) falls back to the
  // generated pixel sprite.
  function coverOf(game, frame) {
    const entry = (window.COVERS || {})[game.id];
    if (!entry) return null;
    const pick = (v) => (Array.isArray(v) ? { src: v[0], w: v[1], h: v[2] } : null);
    return pick(entry[frame === "landscape" ? "h" : "p"]) || pick(entry.h) || pick(entry.p);
  }

  function hueOf(game) {
    const anchor = GENRE_HUE[game.genres[0]] ?? 210;
    return (anchor + (E.hash(game.id) % 29) - 14 + 360) % 360;
  }

  function artOf(game) {
    const h = hueOf(game);
    return {
      bg: `linear-gradient(165deg, hsl(${h} 42% 31%), hsl(${(h + 22) % 360} 48% 13%))`,
      body: `hsl(${h} 85% 66%)`,
      shade: `hsl(${h} 62% 42%)`,
      eye: "#10131f",
    };
  }

  const spriteCache = new Map();
  function spriteUrl(game) {
    if (spriteCache.has(game.id)) return spriteCache.get(game.id);
    const grid = E.spriteGrid(E.hash(game.id));
    const art = artOf(game);
    const c = document.createElement("canvas");
    c.width = 7;
    c.height = 7;
    const ctx = c.getContext("2d");
    const colors = { 1: art.body, 2: art.shade, 3: art.eye };
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const v = grid[y][x];
        if (v) {
          ctx.fillStyle = colors[v];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    const url = c.toDataURL("image/png");
    spriteCache.set(game.id, url);
    return url;
  }

  // Point an <img> at the game's art: cover art when available, sprite
  // otherwise — and back to the sprite if a cover file goes missing. The
  // frame says which variant fits the container ("portrait" or "landscape").
  function applyArt(img, game, frame) {
    const cover = coverOf(game, frame);
    if (!cover) {
      img.src = spriteUrl(game);
      return img;
    }
    img.className += " photo";
    img.width = cover.w;
    img.height = cover.h;
    img.addEventListener("error", function onErr() {
      // A variant file can go missing while the manifest still lists it:
      // try the other variant before giving up on art entirely.
      const other = coverOf(game, frame === "landscape" ? "portrait" : "landscape");
      if (other && other.src !== img.getAttribute("src")) {
        img.src = other.src;
        return;
      }
      img.removeEventListener("error", onErr);
      img.className = img.className.replace(" photo", "");
      img.width = 7;
      img.height = 7;
      img.src = spriteUrl(game);
    });
    img.src = cover.src;
    return img;
  }

  // ---------- chrome ----------

  function sound(name) {
    window.PRAudio.play(name);
  }

  function toast(msg) {
    const node = $("#toast");
    node.textContent = msg;
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
  }

  function announce(msg) {
    $("#live").textContent = msg;
  }

  function setModalId(id) {
    state.modalOpenId = id;
  }

  function closeModal() {
    const ov = $("#overlay");
    if (ov) ov.remove();
    state.modalOpenId = null;
  }

  function genres() {
    return [...new Set(GAMES.flatMap((g) => g.genres))].sort();
  }

  function metaLine(g) {
    return `${g.platforms[0]}, ${g.year}`;
  }

  function renderLadderBar() {
    const bar = $("#ladder-bar");
    bar.textContent = "";
    const select = el("select", "ladder-select");
    select.setAttribute("aria-label", "Active ladder");
    for (const l of Object.values(store.ladders)) {
      const o = el("option", null, l.name);
      o.value = l.id;
      select.appendChild(o);
    }
    select.value = store.active;
    select.addEventListener("change", () => switchLadder(select.value));
    bar.appendChild(select);

    const add = el("button", "btn ghost small", "+ New");
    add.type = "button";
    add.addEventListener("click", () => {
      promptModal("New ladder", "Name it anything: an era, a genre, a mood.", "My SNES ladder", (name) => {
        if (!name.trim()) return;
        newLadder(name.trim());
      });
    });
    bar.appendChild(add);
  }

  function updateChrome() {
    const n = $("#duel-count");
    if (n && ladder()) n.textContent = String(battles().length);
    for (const tab of $("#nav").querySelectorAll("button")) {
      const active = tab.dataset.view === state.view;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    renderLadderBar();
  }

  // ---------- navigation & render ----------

  function navigate(view) {
    const hash = "#/" + view;
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function viewFromHash() {
    if (location.hash === "#/rankings") return "rankings";
    if (location.hash === "#/stats") return "stats";
    if (location.hash === "#/global") return "global";
    return "duel";
  }

  function render() {
    if (state.view !== "global" && !ladder()) return;
    const stage = $("#stage");
    stage.textContent = "";
    if (state.view === "rankings") window.PRViews.rankings(stage);
    else if (state.view === "stats") window.PRViews.stats(stage);
    else if (state.view === "global") window.PRViews.global(stage);
    else window.PRViews.duel(stage);
    updateChrome();
  }

  // ---------- ladder management ----------

  function newLadder(name) {
    const id = "l" + Date.now().toString(36);
    const recs = {};
    for (const g of GAMES) recs[g.id] = E.freshRecord();
    store.ladders[id] = { id, name, recs, battles: [], tournaments: [], currentTournament: null };
    switchLadder(id);
    toast(`Ladder "${name}" created`);
  }

  function switchLadder(id) {
    if (!store.ladders[id]) return;
    store.active = id;
    ensureRecs(store.ladders[id]);
    state.quick.pair = null;
    state.quick.recentIds = [];
    state.quick.filters = { genre: "", era: "" };
    state.placement = null;
    state.lastChampion = null;
    invalidateCaches();
    save();
    sound("tick");
    render();
  }

  function renameLadder(name) {
    const l = ladder();
    if (!l || !name.trim()) return;
    l.name = name.trim();
    save();
    updateChrome();
    toast("Ladder renamed");
  }

  function deleteLadder() {
    if (Object.keys(store.ladders).length <= 1) {
      toast("That's your only ladder. Reset it instead of deleting.");
      return;
    }
    const id = store.active;
    delete store.ladders[id];
    store.active = Object.keys(store.ladders)[0];
    ensureRecs(store.ladders[store.active]);
    state.quick.pair = null;
    state.placement = null;
    state.lastChampion = null;
    invalidateCaches();
    save();
    render();
    toast("Ladder deleted");
  }

  function resetLadder() {
    const l = ladder();
    l.recs = {};
    ensureRecs(l);
    l.battles = [];
    l.tournaments = [];
    l.currentTournament = null;
    state.quick.pair = null;
    state.lastChampion = null;
    state.placement = null;
    invalidateCaches();
    save();
    render();
    toast("Ladder reset to square one");
  }

  // ---------- export / import ----------

  function exportLadder() {
    const l = ladder();
    const payload = {
      app: "pixel-rumble",
      version: 2,
      exported: new Date().toISOString(),
      ladder: { name: l.name, recs: l.recs, battles: l.battles, tournaments: l.tournaments },
    };
    const slug = l.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ladder";
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pixel-rumble-${slug}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Ladder exported");
  }

  function importLadderJson(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      toast("That file isn't valid JSON.");
      return;
    }
    const raw = data && data.ladder && data.ladder.recs ? data.ladder : data && data.recs ? data : null;
    if (!raw || typeof raw.recs !== "object") {
      toast("That file doesn't look like a Pixel Rumble export.");
      return;
    }
    const migrated = E.migrateV1({ recs: raw.recs, battles: raw.battles || [] });
    if (!migrated) {
      toast("That export is missing rating records.");
      return;
    }
    migrated.name = (raw.name || "Imported ladder").slice(0, 40);
    migrated.id = "l" + Date.now().toString(36);
    migrated.tournaments = Array.isArray(raw.tournaments) ? raw.tournaments : [];
    ensureRecs(migrated);
    store.ladders[migrated.id] = migrated;
    switchLadder(migrated.id);
    toast(`Imported "${migrated.name}"`);
  }

  // ---------- small modals ----------

  function promptModal(title, hint, initial, onOk, okLabel) {
    closeModal();
    const overlay = el("div", "overlay");
    overlay.id = "overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
    const panel = el("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", title);
    const body = el("div", "panel-body");
    body.appendChild(el("h3", null, title));
    if (hint) body.appendChild(el("p", "panel-sub", hint));
    const form = el("div", "form-row");
    const input = el("input", "text-input");
    input.type = "text";
    input.value = initial || "";
    input.maxLength = 40;
    form.appendChild(input);
    body.appendChild(form);
    const actions = el("div", "panel-actions");
    const ok = el("button", "btn", okLabel || "Save");
    ok.type = "button";
    const commit = () => {
      closeModal();
      onOk(input.value);
    };
    ok.addEventListener("click", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
    });
    const cancel = el("button", "btn ghost", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", closeModal);
    actions.append(ok, cancel);
    body.appendChild(actions);
    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    setModalId("prompt");
    input.focus();
    input.select();
  }

  function shortcutsModal() {
    closeModal();
    const overlay = el("div", "overlay");
    overlay.id = "overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
    const panel = el("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Keyboard shortcuts");
    const body = el("div", "panel-body");
    body.appendChild(el("h3", null, "Keyboard shortcuts"));
    const list = el("ul", "shortcut-list");
    const rows = [
      ["Pick the left game", "←"],
      ["Pick the right game", "→"],
      ["Skip this pair (quick mode)", "↓ or S"],
      ["Undo last duel (quick mode)", "U"],
      ["Close a dialog", "ESC"],
      ["This list", "?"],
    ];
    for (const [what, key] of rows) {
      const li = el("li");
      li.append(el("span", null, what), el("span", "keys", key));
      list.appendChild(li);
    }
    body.appendChild(list);
    const actions = el("div", "panel-actions");
    const close = el("button", "btn", "Got it");
    close.type = "button";
    close.addEventListener("click", closeModal);
    actions.appendChild(close);
    body.appendChild(actions);
    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    setModalId("shortcuts");
    close.focus();
  }

  // ---------- onboarding gate ----------

  function v1DataAvailable() {
    try {
      return !!localStorage.getItem(V1_KEY);
    } catch (e) {
      return false;
    }
  }

  function showGate() {
    const gate = $("#gate");
    gate.hidden = false;
    gate.classList.add("open");
    gate.textContent = "";
    const card = el("div", "gate-card");
    card.insertAdjacentHTML("afterbegin",
      '<svg class="logo-mark" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="5" width="6" height="6" fill="#ff5a4a"></rect><rect x="9" y="5" width="6" height="6" fill="#4ea8ff"></rect></svg>');
    card.appendChild(el("div", "gate-title", "PIXEL RUMBLE"));
    card.appendChild(el("p", null, "Two games walk in. You pick the winner. Watch your all-time ranking assemble itself, duel by duel."));

    const input = el("input", "text-input");
    input.type = "text";
    input.value = "My all-time ladder";
    input.maxLength = 40;
    input.setAttribute("aria-label", "Ladder name");
    card.appendChild(input);

    const actions = el("div", "gate-actions");
    const start = el("button", "btn", "Press start");
    start.type = "button";
    const begin = (ladderObj) => {
      store.seen = true;
      if (ladderObj) {
        ladderObj.id = "l" + Date.now().toString(36);
        ensureRecs(ladderObj);
        store.ladders[ladderObj.id] = ladderObj;
        store.active = ladderObj.id;
      } else {
        const name = input.value.trim() || "My ladder";
        const id = "l" + Date.now().toString(36);
        const recs = {};
        for (const g of GAMES) recs[g.id] = E.freshRecord();
        store.ladders[id] = { id, name, recs, battles: [], tournaments: [], currentTournament: null };
        store.active = id;
      }
      save();
      gate.classList.remove("open");
      gate.hidden = true;
      gate.textContent = "";
      render();
    };
    start.addEventListener("click", () => begin(null));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") begin(null);
    });
    actions.appendChild(start);

    if (v1DataAvailable()) {
      const importV1 = el("button", "btn ghost", "Import my V1 ladder instead");
      importV1.type = "button";
      importV1.addEventListener("click", () => {
        try {
          const raw = JSON.parse(localStorage.getItem(V1_KEY));
          const migrated = E.migrateV1(raw);
          if (migrated) {
            begin(migrated);
            toast(`V1 ladder imported with ${migrated.battles.length} duels`);
          } else {
            toast("Couldn't read the V1 data.");
          }
        } catch (e) {
          toast("Couldn't read the V1 data.");
        }
      });
      actions.appendChild(importV1);
    }
    card.appendChild(actions);
    gate.appendChild(card);
    input.focus();
    input.select();
  }

  // ---------- keyboard ----------

  document.addEventListener("keydown", (e) => {
    if (e.target instanceof Element && e.target.matches("input, select, textarea")) return;
    if (e.key === "Escape") {
      if (state.modalOpenId) closeModal();
      return;
    }
    if (e.key === "?") {
      shortcutsModal();
      return;
    }
    if (state.modalOpenId || !ladder()) return;
    if (state.view !== "duel") return;

    if (state.duelMode === "quick") {
      if (e.key === "ArrowLeft") window.PRViews.quickPick(0);
      else if (e.key === "ArrowRight") window.PRViews.quickPick(1);
      else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
        e.preventDefault();
        window.PRViews.quickSkip();
      }
      else if (e.key === "u" || e.key === "U") {
        if (canUndo()) {
          undoLast();
          render();
        }
      }
    } else if (state.duelMode === "tournament") {
      const t = tournamentCurrent();
      if (!t) return;
      const nm = E.nextMatch(t.bracket);
      if (!nm) return;
      const match = t.bracket.rounds[nm.r][nm.m];
      if (e.key === "ArrowLeft" && match.a) {
        tournamentPick(match.a, nm.r, nm.m);
        render();
      } else if (e.key === "ArrowRight" && match.b) {
        tournamentPick(match.b, nm.r, nm.m);
        render();
      }
    } else if (state.duelMode === "place" && state.placement && !state.placement.done) {
      if (e.key === "ArrowLeft") window.PRViews.__placePick(true);
      else if (e.key === "ArrowRight") window.PRViews.__placePick(false);
    }
  });

  // ---------- PR facade ----------

  window.PR = {
    E,
    GAMES,
    BY_ID,
    REDUCED,
    gameById: (id) => BY_ID.get(id),
    // state
    get view() { return state.view; },
    set view(v) { state.view = v; },
    get duelMode() { return state.duelMode; },
    set duelMode(v) { state.duelMode = v; },
    get quick() { return state.quick; },
    get rankFilters() { return state.rankFilters; },
    get tournamentCfg() { return state.tournamentCfg; },
    get placement() { return state.placement; },
    set placement(v) { state.placement = v; },
    get lastChampion() { return state.lastChampion; },
    set lastChampion(v) { state.lastChampion = v; },
    // data
    ladder,
    getStore: () => store,
    replaceStore,
    recordOf,
    battles,
    lastBattle,
    applyDuel,
    canUndo,
    undoLast,
    sortGames,
    ratedOrder,
    tiers,
    stats,
    streakOf,
    bestWin,
    worstLoss,
    ratingValues,
    // duel modes
    nextQuickPair,
    startTournament,
    tournamentCurrent,
    tournamentPick,
    abandonTournament,
    tournaments,
    seedOf,
    startPlacement,
    isUnplayed,
    markUnplayed,
    togglePlayed,
    // chrome & helpers
    navigate,
    render,
    rerender: render,
    genres,
    hueOf,
    artOf,
    spriteUrl,
    coverOf,
    applyArt,
    metaLine,
    sound,
    toast,
    announce,
    closeModal,
    setModalId,
    promptModal,
    get modalOpenId() { return state.modalOpenId; },
  };

  // Expose placement picking for keyboard use (views own the flow logic).
  window.PRViews.__placePick = function (candBetter) {
    // Re-dispatch into the view's own handler by clicking the rendered cover,
    // which carries all the state transitions.
    const covers = document.querySelectorAll(".duel-row.place-pick .cover");
    if (covers.length === 2) covers[candBetter ? 0 : 1].click();
  };

  // ---------- boot ----------

  function boot() {
    store = loadStore();
    window.PRAudio.setMuted(!!store.prefs.muted);

    for (const tab of $("#nav").querySelectorAll("button")) {
      tab.addEventListener("click", () => navigate(tab.dataset.view));
    }

    const soundBtn = $("#sound-btn");
    const renderSoundBtn = () => {
      const muted = window.PRAudio.isMuted();
      soundBtn.classList.toggle("on", !muted);
      soundBtn.setAttribute("aria-pressed", String(!muted));
      soundBtn.setAttribute("aria-label", muted ? "Unmute sounds" : "Mute sounds");
      soundBtn.innerHTML = muted
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
    };
    soundBtn.addEventListener("click", () => {
      const muted = !window.PRAudio.isMuted();
      window.PRAudio.setMuted(muted);
      store.prefs.muted = muted;
      save();
      renderSoundBtn();
      if (!muted) sound("tick");
    });
    renderSoundBtn();

    const armTwoStep = (btn, action) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.armed === "true") {
          btn.dataset.armed = "false";
          btn.textContent = btn.dataset.label;
          action();
        } else {
          btn.dataset.armed = "true";
          btn.dataset.label = btn.textContent;
          btn.textContent = "Sure? Click again";
        }
      });
    };
    armTwoStep($("#reset-btn"), resetLadder);
    armTwoStep($("#delete-btn"), deleteLadder);

    $("#export-btn").addEventListener("click", exportLadder);
    $("#import-btn").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => importLadderJson(String(reader.result));
      reader.readAsText(file);
      e.target.value = "";
    });
    $("#rename-btn").addEventListener("click", () => {
      const l = ladder();
      if (l) promptModal("Rename ladder", null, l.name, renameLadder);
    });

    window.addEventListener("hashchange", () => {
      const next = viewFromHash();
      if (next !== state.view) {
        state.view = next;
        render();
      }
    });

    if (store.active && store.ladders[store.active]) {
      ensureRecs(ladder());
      state.view = viewFromHash();
      render();
    }
    if (!store.seen) showGate();
  }

  boot();
})();
