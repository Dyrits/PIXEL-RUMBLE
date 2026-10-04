// Pixel Rumble V2 views: every renderer for the Duel, Rankings and Stats tabs.
// State and actions live in window.PR (app.js); these functions only read
// PR and build DOM, so they can be re-run at any time.
(function () {
  "use strict";

  const P = () => window.PR;
  const E = () => window.PR.E;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const ERAS = [
    { key: "", label: "ALL" },
    { key: "1970", label: "70s" },
    { key: "1980", label: "80s" },
    { key: "1990", label: "90s" },
    { key: "2000", label: "00s" },
    { key: "2010", label: "10s" },
    { key: "2020", label: "20s" },
  ];

  function roundTitle(matches) {
    if (matches === 1) return "FINAL";
    if (matches === 2) return "SEMIFINALS";
    if (matches === 4) return "QUARTERFINALS";
    return "ROUND OF " + matches * 2;
  }

  // ---------- shared bits ----------

  function coverEl(id, side, opts) {
    const pr = P();
    const g = pr.gameById(id);
    const rec = pr.recordOf(id);
    const art = pr.artOf(g);
    const btn = el("button", "cover");
    btn.type = "button";
    btn.classList.add(side === 0 ? "p1" : "p2");
    btn.dataset.id = id;
    btn.setAttribute("aria-label", `${(opts && opts.verb) || "Pick"} ${g.title}`);
    btn.addEventListener("click", () => opts && opts.onClick && opts.onClick());

    const artBox = el("span", "art");
    artBox.style.setProperty("--art", art.bg);
    const img = el("img", "sprite");
    pr.applyArt(img, g, "portrait");
    img.alt = "";
    artBox.appendChild(img);
    const delta = el("span", "delta");
    delta.dataset.side = side === 0 ? "a" : "b";
    artBox.appendChild(delta);

    const meta = el("span", "meta");
    meta.append(
      el("span", "title", g.title),
      el("span", "sub", pr.metaLine(g)),
      el("span", "pts", String(rec.r))
    );
    btn.append(artBox, meta);
    return btn;
  }

  function showDelta(side, d) {
    const node = document.querySelector(`.delta[data-side="${side === 0 ? "a" : "b"}"]`);
    if (!node) return;
    node.textContent = (d > 0 ? "+" : "") + d;
    node.classList.toggle("up", d > 0);
    node.classList.toggle("down", d < 0);
    node.classList.add("show");
  }

  function setDeltaNodes(sideA, sideB) {
    showDelta(0, sideA);
    showDelta(1, sideB);
  }

  // Horizontal swipe on a duel row picks that side (mobile). Vertical pans
  // stay with the browser: the row only claims horizontal gestures
  // (touch-action: pan-y), so page scrolling is never eaten.
  function swipePicks(node, pick) {
    let sx = 0;
    let sy = 0;
    let on = false;
    node.addEventListener("touchstart", (e) => {
      const t = e.changedTouches[0];
      sx = t.clientX;
      sy = t.clientY;
      on = true;
    }, { passive: true });
    node.addEventListener("touchend", (e) => {
      if (!on) return;
      on = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) pick(dx < 0 ? 0 : 1);
    }, { passive: true });
  }

  // One quiet line explaining how to pick: keys on desktop, swipe on touch.
  function duelHint(keysText, touchText) {
    const p = el("p", "duel-hint");
    const keys = el("span", "keys-only", keysText);
    const touch = el("span", "touch-only", touchText);
    p.append(keys, touch);
    return p;
  }

  // A long title wraps taller than a short one; give both cards in a pair
  // the same reserved meta height so the cards (and their art) stay equal.
  function syncMetaHeights(row) {
    const metas = [...row.querySelectorAll(".cover .meta")];
    if (metas.length < 2) return;
    const set = () => {
      const h = Math.max(...metas.map((m) => m.getBoundingClientRect().height));
      for (const m of metas) m.style.minHeight = h + "px";
    };
    set();
    requestAnimationFrame(set); // re-measure after web-font swap
  }

  function thumbHolder(g, cls) {
    const pr = P();
    const holder = el("span", "cell artholder " + (cls || ""));
    holder.style.setProperty("--art", pr.artOf(g).bg);
    const img = el("img", "thumb");
    pr.applyArt(img, g, "portrait");
    img.alt = "";
    holder.appendChild(img);
    return holder;
  }

  // ---------- duel tab ----------

  function duel(stage) {
    const pr = P();
    const tabs = el("div", "mode-tabs");
    tabs.setAttribute("role", "tablist");
    for (const [key, label] of [["quick", "Quick duel"], ["tournament", "Tournament"], ["place", "Slot a game"]]) {
      const b = el("button", null, label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(pr.duelMode === key));
      b.classList.toggle("active", pr.duelMode === key);
      b.addEventListener("click", () => {
        pr.duelMode = key;
        pr.sound("tick");
        pr.rerender();
      });
      tabs.appendChild(b);
    }
    stage.appendChild(tabs);

    if (pr.duelMode === "tournament") tournamentPane(stage);
    else if (pr.duelMode === "place") placementPane(stage);
    else quickPane(stage);
  }

  // ----- quick mode -----

  function quickPane(stage) {
    const pr = P();
    const filters = pr.quick.filters;

    const filterRow = el("div", "filters");
    for (const era of ERAS) {
      const chip = el("button", "chip", era.label);
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(filters.era === era.key));
      chip.classList.toggle("active", filters.era === era.key);
      chip.addEventListener("click", () => {
        filters.era = era.key;
        pr.nextQuickPair();
        pr.rerender();
      });
      filterRow.appendChild(chip);
    }
    const genreSel = el("select", "genre-select");
    genreSel.setAttribute("aria-label", "Duel pool genre");
    const allG = el("option", null, "All genres");
    allG.value = "";
    genreSel.appendChild(allG);
    for (const g of pr.genres()) {
      const o = el("option", null, g);
      o.value = g;
      genreSel.appendChild(o);
    }
    genreSel.value = filters.genre;
    genreSel.addEventListener("change", () => {
      filters.genre = genreSel.value;
      pr.nextQuickPair();
      pr.rerender();
    });
    filterRow.appendChild(genreSel);
    stage.appendChild(filterRow);

    if (!pr.quick.pair) pr.nextQuickPair();
    if (!pr.quick.pair) {
      stage.appendChild(el("p", "no-match", "No games match those filters. Loosen them to keep duelling."));
      return;
    }

    stage.appendChild(el("h1", "ask", "Which game is better?"));
    const row = el("div", "duel-row");
    row.appendChild(coverEl(pr.quick.pair[0], 0, { onClick: () => quickPick(0) }));
    row.appendChild(el("div", "vs", "VS"));
    row.appendChild(coverEl(pr.quick.pair[1], 1, { onClick: () => quickPick(1) }));
    stage.appendChild(row);
    syncMetaHeights(row);
    swipePicks(row, (side) => quickPick(side));
    stage.appendChild(duelHint("\u2190 \u2192 pick \u00b7 \u2193 skip \u00b7 U undo", "Tap a card, or swipe toward your pick"));

    const npRow = el("div", "np-row");
    const [aId, bId] = pr.quick.pair;
    const npBtn = (label, ids) => {
      const b = el("button", "np-btn", label);
      b.type = "button";
      b.title = label;
      b.addEventListener("click", () => notPlayed(ids));
      npRow.appendChild(b);
    };
    npBtn(`Haven't played ${pr.gameById(aId).title}`, [aId]);
    npBtn(`Haven't played ${pr.gameById(bId).title}`, [bId]);
    npBtn("Haven't played either", [aId, bId]);
    stage.appendChild(npRow);

    const last = pr.lastBattle();
    stage.appendChild(el(
      "p",
      "last-duel",
      last ? `Last duel: ${pr.gameById(last.winner).title} over ${pr.gameById(last.a === last.winner ? last.b : last.a).title}` : "No duels yet. Pick the game you think is better."
    ));
  }

  function quickPick(side) {
    const pr = P();
    if (pr.quick.locked || !pr.quick.pair) return;
    pr.quick.locked = true;
    pr.sound("pick");
    const [aId, bId] = pr.quick.pair;
    const winnerId = side === 0 ? aId : bId;
    const loserId = side === 0 ? bId : aId;
    const { deltaA, deltaB } = pr.applyDuel(aId, bId, winnerId, "quick");
    pr.announce(`${pr.gameById(winnerId).title} beats ${pr.gameById(loserId).title}`);

    const cards = document.querySelectorAll(".cover");
    if (cards.length === 2) {
      cards[side].classList.add("win");
      cards[1 - side].classList.add("lose");
    }
    setDeltaNodes(deltaA, deltaB);

    setTimeout(() => {
      pr.quick.locked = false;
      pr.nextQuickPair();
      pr.rerender();
    }, pr.REDUCED ? 120 : 620);
  }

  function quickSkip() {
    const pr = P();
    if (pr.quick.locked) return;
    pr.sound("skip");
    pr.nextQuickPair();
    pr.rerender();
  }

  function notPlayed(ids) {
    const pr = P();
    if (pr.quick.locked || !pr.quick.pair) return;
    pr.markUnplayed(ids);
    pr.sound("skip");
    pr.toast(
      ids.length === 1
        ? `Marked ${pr.gameById(ids[0]).title} as not played — it won't come up in quick duels`
        : "Marked both as not played — they won't come up in quick duels"
    );
    pr.nextQuickPair();
    pr.rerender();
  }

  // ----- tournament mode -----

  function tournamentPane(stage) {
    const pr = P();
    if (pr.lastChampion) {
      championScreen(stage, pr.lastChampion);
      return;
    }
    const t = pr.tournamentCurrent();
    if (t) tournamentBoard(stage, t);
    else tournamentSetup(stage);
  }

  function tournamentSetup(stage) {
    const pr = P();
    const cfg = pr.tournamentCfg;

    const card = el("div", "duel-config");
    card.appendChild(el("h3", null, "Run a tournament"));
    card.appendChild(el("p", "hint", "Single elimination. Every match is a real duel, so the ladder moves while the bracket plays out."));
    card.appendChild(el("p", "hint", `${pr.GAMES.length} games in the pool.`));

    const sizeRow = el("div", "config-row");
    sizeRow.appendChild(el("span", "label", "Bracket size"));
    const sizeSeg = el("div", "seg");
    for (const size of [8, 16]) {
      const b = el("button", null, String(size));
      b.type = "button";
      b.classList.toggle("active", cfg.size === size);
      b.setAttribute("aria-pressed", String(cfg.size === size));
      b.addEventListener("click", () => {
        cfg.size = size;
        pr.rerender();
      });
      sizeSeg.appendChild(b);
    }
    sizeRow.appendChild(sizeSeg);
    card.appendChild(sizeRow);

    const seedRow = el("div", "config-row");
    seedRow.appendChild(el("span", "label", "Seeding"));
    const seedSeg = el("div", "seg");
    for (const [key, label] of [["random", "Random draw"], ["top", "By rating"]]) {
      const b = el("button", null, label);
      b.type = "button";
      b.classList.toggle("active", cfg.seeding === key);
      b.setAttribute("aria-pressed", String(cfg.seeding === key));
      b.addEventListener("click", () => {
        cfg.seeding = key;
        pr.rerender();
      });
      seedSeg.appendChild(b);
    }
    seedRow.appendChild(seedSeg);
    card.appendChild(seedRow);

    const start = el("button", "btn", "Start tournament");
    start.type = "button";
    start.addEventListener("click", () => {
      pr.startTournament();
      pr.sound("match");
      pr.rerender();
    });
    card.appendChild(start);
    stage.appendChild(card);

    const champs = pr.tournaments();
    if (champs.length) {
      stage.appendChild(el("h3", "stat-section-title", "Past champions"));
      const list = el("div");
      for (const c of champs.slice(-4).reverse()) {
        const row = el("div", "champ-row");
        row.appendChild(thumbHolder(pr.gameById(c.champion)));
        row.appendChild(el("span", "leader-title", `${pr.gameById(c.champion).title} won the ${c.size}-game bracket`));
        row.appendChild(el("span", "when", new Date(c.when).toLocaleDateString()));
        list.appendChild(row);
      }
      stage.appendChild(list);
    }
  }

  function tournamentBoard(stage, t) {
    const pr = P();
    const bracket = t.bracket;
    const current = E().nextMatch(bracket);

    stage.appendChild(el("h1", "ask", current ? "Who wins this match?" : "Tournament complete"));

    const wrap = el("div", "bracket-wrap");
    const grid = el("div", "bracket");
    for (let r = 0; r < bracket.rounds.length; r++) {
      const round = el("div", "round");
      round.appendChild(el("div", "round-title", roundTitle(bracket.rounds[r].length)));
      for (let m = 0; m < bracket.rounds[r].length; m++) {
        const match = bracket.rounds[r][m];
        const isCurrent = current && current.r === r && current.m === m;
        const card = el("div", "match");
        if (isCurrent) card.classList.add("current");
        card.appendChild(matchRow(match, match.a, match.winner, isCurrent, r, m));
        card.appendChild(matchRow(match, match.b, match.winner, isCurrent, r, m));
        if (isCurrent) card.appendChild(el("div", "now-chip", "NOW"));
        round.appendChild(card);
      }
      grid.appendChild(round);
    }
    wrap.appendChild(grid);
    stage.appendChild(wrap);

    if (current) {
      stage.appendChild(el("p", "last-duel", "Click the winner of the highlighted match, or use ← and →."));
    }

    const controls = el("div", "duel-controls");

    const abandon = el("button", "btn ghost", "Abandon tournament");
    abandon.type = "button";
    abandon.addEventListener("click", () => {
      if (abandon.dataset.armed === "true") {
        pr.abandonTournament();
        pr.toast("Tournament abandoned. Played matches still count on the ladder.");
        pr.rerender();
      } else {
        abandon.dataset.armed = "true";
        abandon.textContent = "Abandon? Click again to confirm";
      }
    });
    controls.appendChild(abandon);
    stage.appendChild(controls);
  }

  function matchRow(match, id, winnerId, isCurrent, r, m) {
    const pr = P();
    const row = el("button", "match-row");
    row.type = "button";
    if (!id) {
      row.classList.add("tbd");
      row.disabled = true;
      row.appendChild(el("span", "seed", ""));
      row.appendChild(el("span", "m-name", "Winner of previous"));
      row.appendChild(el("span", "m-pts", ""));
      return row;
    }
    const g = pr.gameById(id);
    const rec = pr.recordOf(id);
    if (winnerId) {
      row.disabled = true;
      if (winnerId === id) row.classList.add("won");
      else row.classList.add("lost");
    } else if (isCurrent) {
      row.addEventListener("click", () => {
        pr.tournamentPick(id, r, m);
        pr.rerender();
      });
    } else {
      row.disabled = true;
    }
    row.appendChild(el("span", "seed", pr.seedOf(id, r)));
    row.appendChild(el("span", "m-name", g.title));
    row.appendChild(el("span", "m-pts", String(rec.r)));
    return row;
  }

  function championScreen(stage, champ) {
    const pr = P();
    const g = pr.gameById(champ.champion);
    const box = el("div", "champion");

    const crown = el("div", "crown");
    crown.innerHTML =
      '<svg viewBox="0 0 24 16" width="72" height="48" aria-hidden="true"><path d="M2 14 L2 5 L7 9 L12 1 L17 9 L22 5 L22 14 Z" fill="#ffc53d"></path></svg>';
    box.appendChild(crown);

    const art = pr.artOf(g);
    const artBox = el("div", "art");
    artBox.style.setProperty("--art", art.bg);
    artBox.style.width = "220px";
    artBox.style.borderRadius = "14px";
    artBox.style.border = "2px solid var(--line)";
    const img = el("img", "sprite");
    pr.applyArt(img, g, "portrait");
    img.alt = "";
    artBox.appendChild(img);
    box.appendChild(artBox);

    box.appendChild(el("h2", null, `${g.title}`));
    box.appendChild(el("p", "champ-sub", `Champion of the ${champ.size}-game bracket. The ladder felt every match.`));

    const controls = el("div", "duel-controls");
    const again = el("button", "btn", "Run another tournament");
    again.type = "button";
    again.addEventListener("click", () => {
      pr.lastChampion = null;
      pr.rerender();
    });
    const back = el("button", "btn ghost", "Back to quick duels");
    back.type = "button";
    back.addEventListener("click", () => {
      pr.lastChampion = null;
      pr.duelMode = "quick";
      pr.navigate("duel");
    });
    controls.append(again, back);
    box.appendChild(controls);
    stage.appendChild(box);

    if (!pr.REDUCED && !champ.confettiDone) {
      champ.confettiDone = true;
      confettiBurst();
    }
  }

  function confettiBurst() {
    const cvs = document.createElement("canvas");
    cvs.id = "confetti";
    cvs.width = window.innerWidth;
    cvs.height = window.innerHeight;
    document.body.appendChild(cvs);
    const ctx = cvs.getContext("2d");
    const colors = ["#ff5a4a", "#4ea8ff", "#ffc53d", "#f4f1e6", "#7ee0a0"];
    const parts = [];
    for (let i = 0; i < 110; i++) {
      parts.push({
        x: cvs.width / 2 + (Math.random() - 0.5) * 140,
        y: cvs.height * 0.3 + (Math.random() - 0.5) * 60,
        vx: (Math.random() - 0.5) * 11,
        vy: -6 - Math.random() * 7,
        s: 4 + Math.floor(Math.random() * 5),
        c: colors[i % colors.length],
        life: 1,
      });
    }
    const t0 = performance.now();
    function frame(t) {
      const dt = Math.min(32, t - t0 ? 16 : 16) / 16;
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      let alive = false;
      for (const p of parts) {
        p.vy += 0.38 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y < cvs.height + 20) alive = true;
        ctx.fillStyle = p.c;
        ctx.fillRect(p.x, p.y, p.s, p.s);
      }
      if (alive && t - t0 < 2400) requestAnimationFrame(frame);
      else cvs.remove();
    }
    requestAnimationFrame(frame);
  }

  // ----- placement mode -----

  function placementPane(stage) {
    const pr = P();
    if (!pr.placement) placementEntry(stage);
    else if (pr.placement.done) placementDone(stage);
    else placementStep(stage);
  }

  function placementEntry(stage) {
    const pr = P();
    stage.appendChild(el("h1", "ask", "Slot a game into your ranking"));
    const hint = el("p", "last-duel");
    hint.style.marginBottom = "10px";
    hint.textContent = "Pick a game below, answer about seven duels, and we drop it exactly where it belongs. Every answer moves the ladder.";
    stage.appendChild(hint);

    const wrap = el("div", "pick-list");
    const input = el("input", "search");
    input.type = "search";
    input.placeholder = "Search games";
    input.setAttribute("aria-label", "Search games to slot");
    input.style.width = "100%";
    input.style.margin = "0 auto 10px";
    input.style.display = "block";
    input.style.maxWidth = "478px";
    stage.appendChild(input);

    const list = el("div");
    list.style.maxWidth = "480px";
    list.style.margin = "0 auto";
    wrap.appendChild(list);
    stage.appendChild(wrap);

    function renderList(q) {
      list.textContent = "";
      const query = (q || "").trim().toLowerCase();
      const games = pr.GAMES.filter((g) => !query || g.title.toLowerCase().includes(query)).slice(0, query ? 12 : 10);
      for (const g of games) {
        const item = el("button", "pick-item");
        item.type = "button";
        item.appendChild(thumbHolder(g));
        const name = el("span", null);
        name.style.flex = "1";
        const t = el("div", "row-title", g.title);
        const s = el("div", "row-sub", pr.metaLine(g));
        name.append(t, s);
        item.appendChild(name);
        const rec = pr.recordOf(g.id);
        item.appendChild(el("span", "h2h-rec", String(rec.r)));
        item.addEventListener("click", () => {
          pr.startPlacement(g.id);
          pr.sound("tick");
          pr.rerender();
        });
        list.appendChild(item);
      }
      if (!games.length) list.appendChild(el("p", "no-match", "No games match that search."));
    }
    renderList("");
    input.addEventListener("input", () => renderList(input.value));

    const controls = el("div", "duel-controls");
    controls.style.marginTop = "16px";
    const surprise = el("button", "btn", "Surprise me with an unrated game");
    surprise.type = "button";
    surprise.addEventListener("click", () => {
      const unrated = pr.GAMES.filter((g) => {
        const r = pr.recordOf(g.id);
        return r.w + r.l === 0;
      });
      if (!unrated.length) {
        pr.toast("Every game already has duels. Pick one from the list.");
        return;
      }
      const pick = unrated[Math.floor(Math.random() * unrated.length)];
      pr.startPlacement(pick.id);
      pr.sound("tick");
      pr.rerender();
    });
    controls.appendChild(surprise);
    stage.appendChild(controls);
  }

  function placementStep(stage) {
    const pr = P();
    const pl = pr.placement;
    const step = E().placementStep(pl.st);
    const cand = pr.gameById(pl.st.cand);
    const opp = pr.gameById(step.oppId);
    const est = Math.ceil(Math.log2(Math.max(2, pl.st.list.length)));

    stage.appendChild(el("h1", "ask", `Where does ${cand.title} belong?`));

    const bar = el("div", "place-bar");
    const track = el("div", "track");
    const fill = el("div", "fill");
    fill.style.width = `${Math.min(100, Math.round((pl.st.steps / est) * 100))}%`;
    track.appendChild(fill);
    bar.append(track, el("span", "steps", `${pl.st.steps}/${est}`));
    stage.appendChild(bar);

    const row = el("div", "duel-row place-pick");
    row.appendChild(coverEl(cand.id, 0, { verb: "Rank", onClick: () => placementPick(true) }));
    row.appendChild(el("div", "vs", "VS"));
    row.appendChild(coverEl(opp.id, 1, { verb: "Rank", onClick: () => placementPick(false) }));
    stage.appendChild(row);
    syncMetaHeights(row);
    swipePicks(row, (side) => placementPick(side === 0));
    stage.appendChild(duelHint("\u2190 \u2192 pick", "Tap a card, or swipe toward your pick"));

    const controls = el("div", "duel-controls");
    const stop = el("button", "btn ghost", "Stop");
    stop.type = "button";
    stop.addEventListener("click", () => {
      pr.placement = null;
      pr.rerender();
    });
    controls.appendChild(stop);
    stage.appendChild(controls);
  }

  function placementPick(candBetter) {
    const pr = P();
    if (pr.quick.locked) return;
    pr.quick.locked = true;
    pr.sound("pick");
    const pl = pr.placement;
    const step = E().placementStep(pl.st);
    const winnerId = candBetter ? pl.st.cand : step.oppId;
    const loserId = candBetter ? step.oppId : pl.st.cand;
    pr.applyDuel(pl.st.cand, step.oppId, winnerId, "place");
    pr.announce(`${pr.gameById(winnerId).title} beats ${pr.gameById(loserId).title}`);
    E().placementAnswer(pl.st, candBetter);
    const next = E().placementStep(pl.st);
    if (next.done) pl.done = { insertAt: next.insertAt };
    setTimeout(() => {
      pr.quick.locked = false;
      pr.rerender();
    }, pr.REDUCED ? 100 : 380);
  }

  function placementDone(stage) {
    const pr = P();
    const pl = pr.placement;
    const cand = pr.gameById(pl.st.cand);
    const at = pl.done.insertAt;
    const list = pl.st.list;

    const card = el("div", "place-done");
    card.appendChild(thumbHolder(cand));
    card.querySelector(".artholder").style.width = "56px";
    card.querySelector(".artholder").style.height = "56px";
    card.appendChild(el("p", "rank-line", `${cand.title} slots in at #${at + 1}`));
    let between;
    if (at === 0) between = el("p", "between", "That's the very top of your ranking.");
    else if (at >= list.length) between = el("p", "between", "That's the very bottom of your ranking.");
    else between = el("p", "between", `Right between ${pr.gameById(list[at - 1]).title} (#${at}) and ${pr.gameById(list[at]).title} (#${at + 2}).`);
    card.appendChild(between);
    const note = el("p", "between");
    note.style.marginBottom = "14px";
    note.textContent = `${pl.st.steps} duels played. The ladder has already absorbed them.`;
    card.appendChild(note);

    const controls = el("div", "duel-controls");
    const another = el("button", "btn", "Slot another game");
    another.type = "button";
    another.addEventListener("click", () => {
      pr.placement = null;
      pr.rerender();
    });
    const view = el("button", "btn ghost", "See the rankings");
    view.type = "button";
    view.addEventListener("click", () => {
      pr.placement = null;
      pr.navigate("rankings");
    });
    controls.append(another, view);
    card.appendChild(controls);
    stage.appendChild(card);
  }

  // ---------- rankings tab ----------

  const sortState = { key: "rating", dir: -1 };
  const sortKeys = [
    ["rating", "Rating"],
    ["title", "Title"],
    ["year", "Year"],
    ["duels", "Duels"],
    ["winrate", "Win rate"],
  ];

  function rankings(stage) {
    const pr = P();
    const filters = pr.rankFilters;

    const head = el("div", "rank-head");
    head.appendChild(el("h2", null, "Your rankings"));
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
    const genreSel = el("select", "genre-select");
    genreSel.setAttribute("aria-label", "Filter by genre");
    const allG = el("option", null, "All genres");
    allG.value = "";
    genreSel.appendChild(allG);
    for (const g of pr.genres()) {
      const o = el("option", null, g);
      o.value = g;
      genreSel.appendChild(o);
    }
    genreSel.value = filters.genre;
    genreSel.addEventListener("change", () => {
      filters.genre = genreSel.value;
      renderTable();
    });
    const eraSel = el("select", "era-select");
    eraSel.setAttribute("aria-label", "Filter by era");
    const allE = el("option", null, "All eras");
    allE.value = "";
    eraSel.appendChild(allE);
    for (const era of ERAS.slice(1)) {
      const o = el("option", null, era.label);
      o.value = era.key;
      eraSel.appendChild(o);
    }
    eraSel.value = filters.era;
    eraSel.addEventListener("change", () => {
      filters.era = eraSel.value;
      renderTable();
    });
    tools.append(search, genreSel, eraSel);
    head.appendChild(tools);
    stage.appendChild(head);

    if (pr.battles().length === 0) {
      const empty = el("div", "empty-note");
      empty.appendChild(el("span", null, "No duels yet. Everyone sits at 1500 until you start voting."));
      const go = el("button", "btn", "Start the first duel");
      go.type = "button";
      go.addEventListener("click", () => pr.navigate("duel"));
      empty.appendChild(go);
      stage.appendChild(empty);
    }

    const table = el("div", "table");
    table.id = "rank-table";
    stage.appendChild(table);
    renderTable();
  }

  function renderTable() {
    const pr = P();
    const table = $("#rank-table");
    if (!table) return;
    table.textContent = "";
    const filters = pr.rankFilters;

    const header = el("div", "row head-row");
    header.append(
      el("span", "cell rank", "Rank"),
      el("span", "cell artholder", ""),
      el("span", "cell", "Tier"),
      el("span", "cell game", "Game")
    );
    for (const [key, label] of sortKeys) {
      const th = el("span", `cell ${key === "rating" ? "pts" : key === "title" ? "game" : key === "winrate" ? "pct" : "rec"}`);
      const btn = el("button", "sortable" + (sortState.key === key ? " active" : ""), label);
      btn.type = "button";
      const ind = el("span", "sort-ind", sortState.key === key ? (sortState.dir === -1 ? "▼" : "▲") : "");
      btn.appendChild(ind);
      btn.addEventListener("click", () => {
        if (sortState.key === key) sortState.dir *= -1;
        else {
          sortState.key = key;
          sortState.dir = key === "title" ? 1 : -1;
        }
        renderTable();
      });
      th.appendChild(btn);
      header.appendChild(th);
    }
    table.appendChild(header);

    // Rank (and tier) come from the rating order, independent of display sort.
    const ratingOrder = pr.sortGames();
    const rankMap = new Map(ratingOrder.map((id, i) => [id, i + 1]));
    const tiers = pr.tiers();

    const q = filters.query.trim().toLowerCase();
    let rows = ratingOrder.filter((id) => {
      const g = pr.gameById(id);
      if (q && !g.title.toLowerCase().includes(q)) return false;
      if (filters.genre && !g.genres.includes(filters.genre)) return false;
      if (filters.era && String(Math.floor(g.year / 10) * 10) !== filters.era) return false;
      return true;
    });

    rows = rows.slice().sort((x, y) => {
      const gx = pr.gameById(x);
      const gy = pr.gameById(y);
      const rx = pr.recordOf(x);
      const ry = pr.recordOf(y);
      let v = 0;
      if (sortState.key === "title") v = gx.title.localeCompare(gy.title);
      else if (sortState.key === "year") v = gx.year - gy.year;
      else if (sortState.key === "duels") v = (rx.w + rx.l) - (ry.w + ry.l);
      else if (sortState.key === "winrate") v = winRate(rx) - winRate(ry);
      else v = rx.r - ry.r;
      return v * sortState.dir || gx.title.localeCompare(gy.title);
    });

    for (const id of rows) {
      const g = pr.gameById(id);
      const rec = pr.recordOf(id);
      const played = rec.w + rec.l;
      const rank = rankMap.get(id);

      const row = el("button", "row");
      row.type = "button";
      row.setAttribute("aria-label", `${g.title} details`);

      const rankCell = el("span", "cell rank", String(rank));
      if (rank === 1) rankCell.classList.add("gold");
      else if (rank === 2) rankCell.classList.add("silver");
      else if (rank === 3) rankCell.classList.add("bronze");

      const tierCell = el("span", "cell");
      const tier = tiers[id];
      if (tier) {
        const chip = el("span", "tier " + tier, tier);
        tierCell.appendChild(chip);
      }

      const gameCell = el("span", "cell game");
      const titleRow = el("span", "row-title");
      titleRow.textContent = g.title;
      const streak = pr.streakOf(id);
      if (streak && streak.n >= 2) {
        const s = el("span", "streak " + streak.type, `${streak.type}${streak.n}`);
        titleRow.appendChild(s);
      }
      gameCell.append(titleRow, el("span", "row-sub", `${g.genres[0]}, ${pr.metaLine(g)}`));

      const pts = el("span", "cell pts", String(rec.r));
      const recTxt = played ? `${rec.w}\u2013${rec.l}` : "\u2013";
      const pct = played ? Math.round((rec.w / played) * 100) + "%" : "\u2013";

      row.append(rankCell, thumbHolder(g), tierCell, gameCell, pts, el("span", "cell rec", recTxt), el("span", "cell pct", pct));
      row.addEventListener("click", () => openGameModal(id));
      table.appendChild(row);
    }

    if (!rows.length) {
      table.appendChild(el("p", "no-match", "No games match those filters."));
    }
  }

  function winRate(rec) {
    const n = rec.w + rec.l;
    return n ? rec.w / n : 0;
  }

  // ---------- game modal ----------

  function openGameModal(id) {
    const pr = P();
    pr.closeModal();
    const g = pr.gameById(id);
    const rec = pr.recordOf(id);
    const played = rec.w + rec.l;
    const tiers = pr.tiers();

    const overlay = el("div", "overlay");
    overlay.id = "overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) pr.closeModal();
    });
    const panel = el("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", g.title);

    const banner = el("div", "panel-art");
    banner.style.setProperty("--art", pr.artOf(g).bg);
    const big = el("img", "sprite big");
    pr.applyArt(big, g, "landscape");
    big.alt = "";
    banner.appendChild(big);

    const body = el("div", "panel-body");
    body.appendChild(el("h3", null, g.title));
    body.appendChild(el("p", "panel-sub", `${g.dev}, ${g.year}, ${g.platforms.join(", ")}`));
    const tags = el("div", "genre-tags");
    for (const genre of g.genres) tags.appendChild(el("span", "genre-tag", genre));
    body.appendChild(tags);

    const stats = el("div", "stat-grid");
    const mk = (label, value) => {
      const cell = el("div", "stat");
      cell.append(el("span", "stat-label", label), el("span", "stat-value", value));
      return cell;
    };
    const streak = pr.streakOf(id);
    stats.append(
      mk("Rating", String(rec.r)),
      mk("Rank", "#" + (pr.sortGames().indexOf(id) + 1)),
      mk("Record", played ? `${rec.w} wins, ${rec.l} losses` : "No duels yet"),
      mk("Win rate", played ? Math.round((rec.w / played) * 100) + "%" : "\u2013"),
      mk("Duels", String(played)),
      mk("Tier", tiers[id] ? tiers[id] + " tier" : "unrated")
    );
    if (streak && streak.n >= 2) stats.append(mk("Streak", `${streak.n} straight ${streak.type === "W" ? "wins" : "losses"}`));
    const bw = pr.bestWin(id);
    const wl = pr.worstLoss(id);
    if (bw) stats.append(mk("Best win", `${pr.gameById(bw).title} (${pr.recordOf(bw).r})`));
    if (wl) stats.append(mk("Worst loss", `${pr.gameById(wl).title} (${pr.recordOf(wl).r})`));
    body.appendChild(stats);

    if (rec.hist.length > 1) {
      const wrap = el("div", "spark-wrap");
      const cv = el("canvas", "spark");
      cv.width = 460;
      cv.height = 84;
      cv.setAttribute("aria-label", "Rating history");
      wrap.appendChild(cv);
      body.appendChild(wrap);
      requestAnimationFrame(() => drawSpark(cv, rec.hist));
    }

    const h2h = E().headToHead(pr.battles(), id);
    if (h2h.length) {
      body.appendChild(el("h3", "h2h-title", "Head to head"));
      const list = el("div", "h2h-list");
      for (const h of h2h.slice(0, 6)) {
        const row = el("div", "h2h-row");
        row.appendChild(thumbHolder(pr.gameById(h.opp)));
        row.appendChild(el("span", "h2h-name", pr.gameById(h.opp).title));
        row.appendChild(el("span", "h2h-rec", `${h.wins}\u2013${h.losses}`));
        list.appendChild(row);
      }
      body.appendChild(list);
    }

    const actions = el("div", "panel-actions");
    const duelBtn = el("button", "btn", "Put this game in a duel");
    duelBtn.type = "button";
    duelBtn.addEventListener("click", () => {
      pr.closeModal();
      pr.duelMode = "quick";
      pr.nextQuickPair(id);
      pr.navigate("duel");
    });
    const placeBtn = el("button", "btn ghost", "Slot into ranking");
    placeBtn.type = "button";
    placeBtn.addEventListener("click", () => {
      pr.closeModal();
      pr.duelMode = "place";
      pr.startPlacement(id);
      pr.navigate("duel");
    });
    const playedBtn = el("button", "btn ghost", pr.isUnplayed(id) ? "Mark as played" : "Mark as not played");
    playedBtn.type = "button";
    playedBtn.addEventListener("click", () => {
      pr.togglePlayed(id);
      playedBtn.textContent = pr.isUnplayed(id) ? "Mark as played" : "Mark as not played";
    });
    const close = el("button", "btn ghost", "Close");
    close.type = "button";
    close.addEventListener("click", () => pr.closeModal());
    actions.append(duelBtn, placeBtn, playedBtn, close);
    body.appendChild(actions);

    panel.append(banner, body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    pr.setModalId(id);
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

  // ---------- stats tab ----------

  function stats(stage) {
    const pr = P();
    const s = pr.stats();

    if (s.duels === 0) {
      const empty = el("div", "empty-note");
      empty.appendChild(el("span", null, "Stats unlock once you've played some duels."));
      const go = el("button", "btn", "Go duel");
      go.type = "button";
      go.addEventListener("click", () => pr.navigate("duel"));
      empty.appendChild(go);
      stage.appendChild(empty);
      return;
    }

    stage.appendChild(el("h2", null, "Ladder stats"));

    const tiles = el("div", "stats-tiles");
    const tile = (num, label, note) => {
      const t = el("div", "tile");
      t.appendChild(el("span", "tile-num", num));
      t.appendChild(el("span", "tile-label", label));
      if (note) t.appendChild(el("span", "tile-note", note));
      return t;
    };
    tiles.appendChild(tile(String(s.duels), "duels played"));
    tiles.appendChild(tile(`${s.ratedCount}/${pr.GAMES.length}`, "games rated", `${Math.round((s.ratedCount / pr.GAMES.length) * 100)}% of the roster`));
    tiles.appendChild(tile(String(pr.tournaments().length), "tournaments held"));
    if (s.longestStreak) {
      const g = pr.gameById(s.longestStreak.id);
      tiles.appendChild(tile(String(s.longestStreak.n), "longest win streak", g.title));
    }
    if (s.biggestUpset) {
      tiles.appendChild(tile("+" + s.biggestUpset.gap, "biggest upset", `${pr.gameById(s.biggestUpset.winner).title} over ${pr.gameById(s.biggestUpset.loser).title}`));
    }
    if (s.mostDueled) {
      tiles.appendChild(tile(String(s.mostDueled.n), "most-duelled game", pr.gameById(s.mostDueled.id).title));
    }
    stage.appendChild(tiles);

    // Top 10 bar chart.
    const topBlock = el("div", "chart-block");
    topBlock.appendChild(el("h3", null, "Top 10 by rating"));
    const bar = el("canvas", "chart-canvas");
    bar.width = 900;
    bar.height = 360;
    topBlock.appendChild(bar);
    stage.appendChild(topBlock);

    // Rating distribution.
    const distBlock = el("div", "chart-block");
    distBlock.appendChild(el("h3", null, "Rating spread"));
    const hist = el("canvas", "chart-canvas");
    hist.width = 900;
    hist.height = 260;
    distBlock.appendChild(hist);
    stage.appendChild(distBlock);

    requestAnimationFrame(() => {
      drawTop10(bar, pr.sortGames().slice(0, 10));
      drawHist(hist, pr.ratingValues());
    });

    // Genre leaders.
    stage.appendChild(el("h3", "stat-section-title", "Genre leaders"));
    const leaders = el("div");
    for (const genre of pr.genres()) {
      const best = pr.sortGames().map(pr.gameById).find((g) => {
        const r = pr.recordOf(g.id);
        return g.genres.includes(genre) && r.w + r.l > 0;
      });
      if (!best) continue;
      const row = el("div", "leader-row");
      row.appendChild(el("span", "genre-name", genre));
      row.appendChild(thumbHolder(best));
      row.appendChild(el("span", "leader-title", best.title));
      row.appendChild(el("span", "leader-pts", String(pr.recordOf(best.id).r)));
      row.addEventListener("click", () => openGameModal(best.id));
      leaders.appendChild(row);
    }
    if (!leaders.childNodes.length) {
      leaders.appendChild(el("p", "no-match", "Genre leaders appear as their winners get rated."));
    }
    stage.appendChild(leaders);

    // Rivalry + champions.
    if (s.rivalry) {
      stage.appendChild(el("h3", "stat-section-title", "Closest rivalry"));
      const row = el("div", "champ-row");
      row.appendChild(thumbHolder(pr.gameById(s.rivalry.a)));
      row.appendChild(el("span", "leader-title", `${pr.gameById(s.rivalry.a).title} vs ${pr.gameById(s.rivalry.b).title}`));
      row.appendChild(el("span", "h2h-rec", `${s.rivalry.aWins}\u2013${s.rivalry.bWins} over ${s.rivalry.matches} duels`));
      stage.appendChild(row);
    }

    const champs = pr.tournaments();
    if (champs.length) {
      stage.appendChild(el("h3", "stat-section-title", "Hall of champions"));
      const list = el("div");
      for (const c of champs.slice().reverse()) {
        const row = el("div", "champ-row");
        row.appendChild(thumbHolder(pr.gameById(c.champion)));
        row.appendChild(el("span", "leader-title", `${pr.gameById(c.champion).title} won the ${c.size}-game bracket`));
        row.appendChild(el("span", "when", new Date(c.when).toLocaleDateString()));
        list.appendChild(row);
      }
      stage.appendChild(list);
    }
  }

  function drawTop10(cv, ids) {
    const pr = P();
    const ctx = cv.getContext("2d");
    const W = cv.width;
    const H = cv.height;
    const n = ids.length;
    const rowH = H / n;
    const values = ids.map((id) => pr.recordOf(id).r);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = Math.max(max - min, 60);
    ctx.clearRect(0, 0, W, H);
    ids.forEach((id, i) => {
      const g = pr.gameById(id);
      const r = pr.recordOf(id).r;
      const y = i * rowH;
      const barX = 268;
      const barW = W - barX - 96;
      const w = Math.max(6, ((r - (min - 20)) / (span + 20)) * barW);
      const hue = pr.hueOf(g);
      ctx.fillStyle = `hsl(${hue} 85% 66%)`;
      ctx.fillRect(barX, y + rowH * 0.22, w, rowH * 0.56);
      ctx.fillStyle = "#f4f1e6";
      ctx.font = "600 17px 'Bricolage Grotesque', system-ui, sans-serif";
      ctx.textAlign = "right";
      const label = g.title.length > 32 ? g.title.slice(0, 31) + "\u2026" : g.title;
      ctx.fillText(label, barX - 14, y + rowH * 0.62);
      ctx.fillStyle = "#ffc53d";
      ctx.font = "14px Silkscreen, monospace";
      ctx.textAlign = "left";
      ctx.fillText(String(r), barX + w + 10, y + rowH * 0.62);
    });
  }

  function drawHist(cv, values) {
    const h = E().histogram(values, 25);
    const ctx = cv.getContext("2d");
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (!h.bins.length) return;
    const padX = 30;
    const padTop = 16;
    const padBottom = 30;
    const maxCount = Math.max(...h.bins);
    const bw = (W - padX * 2) / h.bins.length;
    h.bins.forEach((count, i) => {
      const bh = (count / maxCount) * (H - padTop - padBottom);
      ctx.fillStyle = "#4ea8ff";
      ctx.fillRect(padX + i * bw + 2, H - padBottom - bh, bw - 4, bh);
    });
    // 1500 baseline marker, drawn only when the window covers it.
    const hi = h.min + h.bins.length * h.binSize;
    if (1500 >= h.min && 1500 <= hi) {
      const x = padX + ((1500 - h.min) / (h.bins.length * h.binSize)) * (W - padX * 2);
      ctx.fillStyle = "rgba(244, 241, 230, 0.5)";
      ctx.fillRect(x, padTop - 8, 2, H - padTop - padBottom + 8);
      ctx.fillStyle = "#aeb4d4";
      ctx.font = "12px Silkscreen, monospace";
      ctx.textAlign = "center";
      ctx.fillText("1500", x, H - 8);
    }
    ctx.fillStyle = "#aeb4d4";
    ctx.textAlign = "left";
    ctx.fillText(String(h.min), padX, H - 8);
    ctx.textAlign = "right";
    ctx.fillText(String(hi), W - padX, H - 8);
  }

  // ---------- exports ----------

  window.PRViews = {
    duel,
    rankings,
    stats,
    openGameModal,
    quickPick,
    quickSkip,
    coverEl,
  };
})();
