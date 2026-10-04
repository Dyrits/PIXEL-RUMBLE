// Pixel Rumble — a Flickchart for video games. UI layer; logic lives in engine.js.
(function () {
  "use strict";

  const E = window.PixelRumbleEngine;
  const GAMES = window.GAMES;
  const BY_ID = new Map(GAMES.map((g) => [g.id, g]));
  const STORAGE_KEY = "pixel-rumble.v1";
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Each genre anchors a hue; each game shifts it by hash so covers vary inside a genre.
  const GENRE_HUE = {
    Arcade: 45, Platformer: 210, RPG: 275, Shooter: 195, Action: 8,
    "Action-Adventure": 135, Fighting: 345, Racing: 25, Puzzle: 310,
    Strategy: 80, Simulation: 160, Horror: 230, Sports: 100,
    Roguelike: 0, Sandbox: 65, Adventure: 175,
  };

  // ---------- state ----------

  let state = load() || freshState();
  let view = "duel"; // "duel" | "rankings"
  let pair = null; // [idA, idB]
  let locked = false;
  let recentIds = [];
  let filters = { query: "", genre: "" };
  const rng = E.seededRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

  function freshState() {
    const recs = {};
    for (const g of GAMES) recs[g.id] = E.freshRecord();
    return { recs, battles: [] };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || !data.recs) return null;
      // Re-seed any games added to the roster after this ladder was saved.
      for (const g of GAMES) {
        if (!data.recs[g.id]) data.recs[g.id] = E.freshRecord();
      }
      data.battles = Array.isArray(data.battles) ? data.battles : [];
      return data;
    } catch {
      return null;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* private mode: play without persistence */
    }
  }

  // ---------- art ----------

  function hueOf(game) {
    const anchor = GENRE_HUE[game.genre] ?? 210;
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

  // ---------- shared helpers ----------

  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function gameById(id) {
    return BY_ID.get(id);
  }

  function metaLine(g) {
    return `${g.platform}, ${g.year}`;
  }

  function sortedGames() {
    return GAMES.slice().sort((a, b) => {
      const ra = state.recs[a.id];
      const rb = state.recs[b.id];
      if (rb.r !== ra.r) return rb.r - ra.r;
      const ba = ra.w + ra.l;
      const bb = rb.w + rb.l;
      if (bb !== ba) return bb - ba;
      return a.title.localeCompare(b.title);
    });
  }

  function recordOf(id) {
    return state.recs[id] || (state.recs[id] = E.freshRecord());
  }

  function bestWin(id) {
    let best = null;
    for (const b of state.battles) {
      if (b.winner !== id) continue;
      const opp = b.a === id ? b.b : b.a;
      if (!best || recordOf(opp).r > recordOf(best).r) best = opp;
    }
    return best;
  }

  function worstLoss(id) {
    let worst = null;
    for (const b of state.battles) {
      if (b.a !== id && b.b !== id) continue;
      if (b.winner === id) continue;
      const opp = b.a === id ? b.b : b.a;
      if (!worst || recordOf(opp).r < recordOf(worst).r) worst = opp;
    }
    return worst;
  }

  // ---------- battle view ----------

  function nextPair(forcedId) {
    const pool = GAMES.map((g) => {
      const rec = recordOf(g.id);
      return { id: g.id, r: rec.r, battles: rec.w + rec.l };
    });
    pair = E.pickPair(pool, recentIds, rng, forcedId);
    recentIds = [...(pair || []), ...recentIds].slice(0, 4);
  }

  function coverEl(id, side) {
    const g = gameById(id);
    const rec = recordOf(id);
    const art = artOf(g);
    const btn = el("button", "cover");
    btn.type = "button";
    btn.classList.add(side === 0 ? "p1" : "p2");
    btn.dataset.id = id;
    btn.dataset.side = String(side);
    btn.setAttribute("aria-label", `Pick ${g.title}`);
    btn.addEventListener("click", () => pick(side));

    const artBox = el("span", "art");
    artBox.style.setProperty("--art", art.bg);
    const img = el("img", "sprite");
    img.src = spriteUrl(g);
    img.alt = "";
    img.width = 7;
    img.height = 7;
    artBox.appendChild(img);
    const delta = el("span", "delta");
    delta.dataset.side = side === 0 ? "a" : "b";
    artBox.appendChild(delta);

    const meta = el("span", "meta");
    const title = el("span", "title", g.title);
    const sub = el("span", "sub", metaLine(g));
    const pts = el("span", "pts", String(rec.r));
    meta.append(title, sub, pts);
    btn.append(artBox, meta);
    return btn;
  }

  function renderDuel() {
    if (!pair) nextPair();
    const stage = $("#stage");
    stage.textContent = "";
    stage.classList.toggle("intro", !REDUCED && !seenIntro);

    const ask = el("h1", "ask", "Which game is better?");
    stage.appendChild(ask);

    const row = el("div", "duel-row");
    row.appendChild(coverEl(pair[0], 0));

    const vs = el("div", "vs", "VS");
    row.appendChild(vs);
    row.appendChild(coverEl(pair[1], 1));
    stage.appendChild(row);

    const controls = el("div", "duel-controls");
    controls.appendChild(pickBtn("Pick left", "←", 0));
    const skip = el("button", "btn ghost");
    skip.type = "button";
    skip.innerHTML = `Can't decide <kbd>S</kbd>`;
    skip.addEventListener("click", () => {
      if (locked) return;
      nextPair();
      renderDuel();
    });
    controls.appendChild(skip);
    controls.appendChild(pickBtn("Pick right", "→", 1));

    const undo = el("button", "btn ghost", "Undo");
    undo.type = "button";
    undo.id = "undo-btn";
    undo.disabled = state.battles.length === 0;
    undo.innerHTML = `Undo <kbd>U</kbd>`;
    undo.addEventListener("click", undoLast);
    controls.appendChild(undo);
    stage.appendChild(controls);

    const lastLine = el("p", "last-duel");
    const last = state.battles[state.battles.length - 1];
    lastLine.textContent = last
      ? `Last duel: ${gameById(last.winner).title} over ${gameById(last.a === last.winner ? last.b : last.a).title}`
      : "No duels yet. Pick the game you think is better.";
    stage.appendChild(lastLine);
  }

  let seenIntro = false;

  function pickBtn(label, key, side) {
    const b = el("button", "btn");
    b.type = "button";
    b.innerHTML = side === 0 ? `<kbd>${key}</kbd> ${label}` : `${label} <kbd>${key}</kbd>`;
    b.addEventListener("click", () => pick(side));
    return b;
  }

  function pick(side) {
    if (locked || !pair) return;
    locked = true;
    const aId = pair[0];
    const bId = pair[1];
    const winnerId = side === 0 ? aId : bId;
    const loserId = side === 0 ? bId : aId;

    const recA = recordOf(aId);
    const recB = recordOf(bId);
    const preA = { ...recA, hist: recA.hist.slice() };
    const preB = { ...recB, hist: recB.hist.slice() };
    const { deltaA, deltaB } = E.duel(aId, recA, bId, recB, winnerId);
    state.battles.push({ a: aId, b: bId, winner: winnerId, preA, preB });
    save();

    // Animate the answer: winner glows in its side's color, loser drops away.
    const cards = document.querySelectorAll(".cover");
    const winCard = cards[side];
    const loseCard = cards[1 - side];
    winCard.classList.add("win");
    loseCard.classList.add("lose");
    const dA = document.querySelector('.delta[data-side="a"]');
    const dB = document.querySelector('.delta[data-side="b"]');
    setDelta(dA, deltaA);
    setDelta(dB, deltaB);
    announce(`${gameById(winnerId).title} beats ${gameById(loserId).title}`);

    const delay = REDUCED ? 120 : 620;
    setTimeout(() => {
      locked = false;
      nextPair();
      renderDuel();
      updateChrome();
    }, delay);
  }

  function setDelta(node, d) {
    if (!node) return;
    node.textContent = (d > 0 ? "+" : "") + d;
    node.classList.toggle("up", d > 0);
    node.classList.toggle("down", d < 0);
    node.classList.add("show");
  }

  function undoLast() {
    const last = state.battles.pop();
    if (!last) return;
    state.recs[last.a] = last.preA;
    state.recs[last.b] = last.preB;
    save();
    pair = [last.a, last.b];
    recentIds = [last.a, last.b];
    renderDuel();
    updateChrome();
    announce("Duel undone");
  }

  // ---------- rankings view ----------

  function renderRankings() {
    const stage = $("#stage");
    stage.textContent = "";

    const head = el("div", "rank-head");
    const h2 = el("h2", null, "Your rankings");
    const tools = el("div", "rank-tools");
    const search = el("input", "search");
    search.type = "search";
    search.placeholder = "Search games";
    search.value = filters.query;
    search.setAttribute("aria-label", "Search games");
    search.addEventListener("input", () => {
      filters.query = search.value;
      renderTable();
    });
    const sel = el("select", "genre-select");
    sel.setAttribute("aria-label", "Filter by genre");
    const genres = [...new Set(GAMES.map((g) => g.genre))].sort();
    const optAll = el("option", null, "All genres");
    optAll.value = "";
    sel.appendChild(optAll);
    for (const g of genres) {
      const o = el("option", null, g);
      o.value = g;
      sel.appendChild(o);
    }
    sel.value = filters.genre;
    sel.addEventListener("change", () => {
      filters.genre = sel.value;
      renderTable();
    });
    tools.append(search, sel);
    head.append(h2, tools);
    stage.appendChild(head);

    if (state.battles.length === 0) {
      const empty = el("div", "empty-note");
      empty.textContent = "No duels yet. Everyone sits at 1500 until you start voting.";
      const go = el("button", "btn", "Start the first duel");
      go.type = "button";
      go.addEventListener("click", () => {
        location.hash = "#/duel";
      });
      empty.appendChild(go);
      stage.appendChild(empty);
    }

    const table = el("div", "table");
    table.id = "rank-table";
    stage.appendChild(table);
    renderTable();
  }

  function renderTable() {
    const table = $("#rank-table");
    if (!table) return;
    table.textContent = "";

    const header = el("div", "row head-row");
    header.append(
      el("span", "cell rank", "Rank"),
      el("span", "cell artholder", ""),
      el("span", "cell game", "Game"),
      el("span", "cell pts", "Rating"),
      el("span", "cell rec", "Record"),
      el("span", "cell pct", "Win rate")
    );
    table.appendChild(header);

    const q = filters.query.trim().toLowerCase();
    const order = sortedGames();
    let shown = 0;
    order.forEach((g, i) => {
      if (q && !g.title.toLowerCase().includes(q)) return;
      if (filters.genre && g.genre !== filters.genre) return;
      shown++;
      const rec = recordOf(g.id);
      const played = rec.w + rec.l;
      const row = el("button", "row");
      row.type = "button";
      row.dataset.id = g.id;
      row.setAttribute("aria-label", `${g.title} details`);

      const rank = el("span", "cell rank", String(i + 1));
      if (i === 0) rank.classList.add("gold");
      else if (i === 1) rank.classList.add("silver");
      else if (i === 2) rank.classList.add("bronze");

      const artHolder = el("span", "cell artholder");
      const thumb = el("img", "thumb");
      thumb.src = spriteUrl(g);
      thumb.alt = "";
      thumb.width = 7;
      thumb.height = 7;
      artHolder.style.setProperty("--art", artOf(g).bg);
      artHolder.appendChild(thumb);

      const gameCell = el("span", "cell game");
      const title = el("span", "row-title", g.title);
      const sub = el("span", "row-sub", `${g.genre}, ${metaLine(g)}`);
      gameCell.append(title, sub);

      const pts = el("span", "cell pts", String(rec.r));
      const recTxt = played ? `${rec.w}\u2013${rec.l}` : "\u2013";
      const recCell = el("span", "cell rec", recTxt);
      const pct = played ? Math.round((rec.w / played) * 100) + "%" : "\u2013";
      const pctCell = el("span", "cell pct", pct);

      row.append(rank, artHolder, gameCell, pts, recCell, pctCell);
      row.addEventListener("click", () => openModal(g.id));
      table.appendChild(row);
    });

    if (shown === 0) {
      const none = el("p", "no-match", "No games match that search.");
      table.appendChild(none);
    }
  }

  // ---------- game detail modal ----------

  let modalOpenId = null;

  function openModal(id) {
    closeModal();
    const g = gameById(id);
    const rec = recordOf(id);
    const played = rec.w + rec.l;

    const overlay = el("div", "overlay");
    overlay.id = "overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
    const panel = el("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", g.title);

    const banner = el("div", "panel-art");
    banner.style.setProperty("--art", artOf(g).bg);
    const big = el("img", "sprite big");
    big.src = spriteUrl(g);
    big.alt = "";
    big.width = 7;
    big.height = 7;
    banner.appendChild(big);

    const body = el("div", "panel-body");
    const h3 = el("h3", null, g.title);
    const sub = el("p", "panel-sub", `${g.dev}, ${g.year}, ${g.platform}`);
    const genre = el("p", "panel-genre", g.genre);
    body.append(h3, sub, genre);

    const stats = el("div", "stat-grid");
    const mk = (label, value) => {
      const cell = el("div", "stat");
      cell.append(el("span", "stat-label", label), el("span", "stat-value", value));
      return cell;
    };
    stats.append(
      mk("Rating", String(rec.r)),
      mk("Record", played ? `${rec.w} wins, ${rec.l} losses` : "No duels yet"),
      mk("Win rate", played ? Math.round((rec.w / played) * 100) + "%" : "\u2013"),
      mk("Duels", String(played))
    );
    const bw = bestWin(id);
    const wl = worstLoss(id);
    if (bw) stats.append(mk("Best win", `${gameById(bw).title} (${recordOf(bw).r})`));
    if (wl) stats.append(mk("Worst loss", `${gameById(wl).title} (${recordOf(wl).r})`));
    body.appendChild(stats);

    const sparkWrap = el("div", "spark-wrap");
    if (rec.hist.length > 1) {
      const cv = el("canvas", "spark");
      cv.width = 460;
      cv.height = 84;
      cv.setAttribute("aria-label", "Rating history");
      sparkWrap.appendChild(cv);
      body.appendChild(sparkWrap);
      requestAnimationFrame(() => drawSpark(cv, rec.hist));
    }

    const actions = el("div", "panel-actions");
    const duel = el("button", "btn", "Put this game in a duel");
    duel.type = "button";
    duel.addEventListener("click", () => {
      closeModal();
      nextPair(id);
      location.hash = "#/duel";
      renderDuel();
      updateChrome();
    });
    const close = el("button", "btn ghost", "Close");
    close.type = "button";
    close.addEventListener("click", closeModal);
    actions.append(duel, close);
    body.appendChild(actions);

    panel.append(banner, body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    modalOpenId = id;
    close.focus();
  }

  function drawSpark(cv, hist) {
    const ctx = cv.getContext("2d");
    const w = cv.width;
    const h = cv.height;
    const min = Math.min(...hist);
    const max = Math.max(...hist);
    const span = Math.max(max - min, 40);
    const pad = 8;
    const x = (i) => pad + (i / (hist.length - 1)) * (w - pad * 2);
    const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);
    ctx.strokeStyle = "#f4f1e6";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.beginPath();
    hist.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.stroke();
    ctx.fillStyle = "#ffc53d";
    const lastX = x(hist.length - 1);
    const lastY = y(hist[hist.length - 1]);
    ctx.fillRect(lastX - 4, lastY - 4, 8, 8);
  }

  function closeModal() {
    const ov = $("#overlay");
    if (ov) ov.remove();
    modalOpenId = null;
  }

  // ---------- chrome ----------

  function updateChrome() {
    const n = $("#duel-count");
    if (n) n.textContent = String(state.battles.length);
    const tabDuel = $('#nav [data-view="duel"]');
    const tabRank = $('#nav [data-view="rankings"]');
    tabDuel.classList.toggle("active", view === "duel");
    tabDuel.setAttribute("aria-selected", view === "duel");
    tabRank.classList.toggle("active", view === "rankings");
    tabRank.setAttribute("aria-selected", view === "rankings");
  }

  function render() {
    if (view === "rankings") renderRankings();
    else renderDuel();
    updateChrome();
    seenIntro = true;
  }

  function announce(msg) {
    const live = $("#live");
    live.textContent = msg;
  }

  // ---------- reset ----------

  function armReset(btn) {
    if (btn.dataset.armed === "true") return;
    btn.dataset.armed = "true";
    btn.textContent = "Wipe all duels?";
    const disarm = () => {
      btn.dataset.armed = "false";
      btn.textContent = "Reset ladder";
      confirmBtn.remove();
      cancelBtn.remove();
    };
    const confirmBtn = el("button", "btn danger", "Yes, wipe it");
    confirmBtn.type = "button";
    confirmBtn.addEventListener("click", () => {
      disarm();
      state = freshState();
      save();
      pair = null;
      recentIds = [];
      render();
      announce("Ladder reset");
    });
    const cancelBtn = el("button", "btn ghost", "Keep it");
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", disarm);
    btn.after(confirmBtn, cancelBtn);
  }

  // ---------- keyboard ----------

  document.addEventListener("keydown", (e) => {
    // Ignore shortcuts while typing; e.target can be document itself for
    // synthetic events, where matches() does not exist.
    if (e.target instanceof Element && e.target.matches("input, select, textarea")) return;
    if (e.key === "Escape" && modalOpenId) {
      closeModal();
      return;
    }
    if (modalOpenId || view !== "duel") return;
    if (e.key === "ArrowLeft") pick(0);
    else if (e.key === "ArrowRight") pick(1);
    else if (e.key === "s" || e.key === "S") {
      nextPair();
      renderDuel();
    } else if (e.key === "u" || e.key === "U") undoLast();
  });

  // ---------- wiring ----------

  window.addEventListener("hashchange", () => {
    const next = location.hash === "#/rankings" ? "rankings" : "duel";
    if (next !== view) {
      view = next;
      render();
    }
  });

  function init() {
    view = location.hash === "#/rankings" ? "rankings" : "duel";
    const nav = $("#nav");
    for (const tab of nav.querySelectorAll("button")) {
      tab.addEventListener("click", () => {
        location.hash = tab.dataset.view === "rankings" ? "#/rankings" : "#/duel";
      });
    }
    $("#reset-btn").addEventListener("click", (e) => armReset(e.currentTarget));
    render();
  }

  init();
})();
