// Pixel Rumble ladder sync + global ranking client. Zero-dependency like the
// rest of the SPA. Rides on two hooks: app.js calls PRSync.onSave() on every
// persisted change (debounced push), and auth.js dispatches pr:signedin /
// pr:signedout (pull-and-merge on sign-in). The merge itself lives in
// engine.js so it is testable in Node. Also exposes PRGlobal.get() for the
// Global tab's view data.
(function () {
  "use strict";

  const E = window.PixelRumbleEngine;
  const $ = (sel) => document.querySelector(sel);

  // Revision of the store last known on the server; 0 means "nothing pushed
  // yet". Pushes carry it as their base so the server can reject writes
  // built on stale state.
  let rev = 0;
  let pushTimer = null;
  let pushing = false;
  let offline = false;
  let toastTimer = null;

  async function api(path, opts) {
    const res = await fetch(path, {
      method: (opts && opts.method) || "GET",
      headers: { "Content-Type": "application/json" },
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }

  function toast(msg) {
    const node = $("#toast");
    if (!node) return;
    node.textContent = msg;
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
  }

  function currentStore() {
    return window.PR ? window.PR.getStore() : null;
  }

  // Merges a remote store into this device. `notify` says whether the
  // "Merged your duels" toast is welcome at this call site.
  function applyRemote(remoteStore, notify) {
    const local = currentStore();
    const merged = E.mergeStores(local, remoteStore);
    if (!merged) return;
    if (!local || JSON.stringify(merged) !== JSON.stringify(local)) {
      window.PR.replaceStore(merged);
      if (notify) toast("Merged your duels from other devices");
    }
  }

  // Pulls the server store and merges it into this device. When both sides
  // have duels the merged union is pushed back so the server keeps the
  // superset; a device that was ahead just confirms its own state.
  async function pullAndMerge() {
    let out;
    try {
      out = await api("/api/sync");
    } catch (e) {
      return; // offline / server down: local state stays authoritative
    }
    if (!out.ok || out.status === 401) return;
    rev = out.data.rev || 0;
    const remoteHasDuels = Object.values((out.data.store && out.data.store.ladders) || {})
      .some((l) => l.battles && l.battles.length);
    if (out.data.store) applyRemote(out.data.store, remoteHasDuels);
    schedulePush(0);
  }

  async function push() {
    if (pushing || !window.PRAuth || !window.PRAuth.user) return;
    pushing = true;
    try {
      const store = currentStore();
      if (!store) return;
      const out = await api("/api/sync", { method: "PUT", body: { baseRev: rev, store } });
      if (out.ok) {
        rev = out.data.rev || rev + 1;
        if (offline) toast("Back online — ladder synced");
        offline = false;
        return;
      }
      if (out.status === 401) {
        rev = 0;
        return;
      }
      if (out.status === 409) {
        // The server moved on: merge its state in and push the union.
        rev = out.data.rev || 0;
        if (out.data.store) applyRemote(out.data.store, true);
        schedulePush(0);
      }
    } catch (e) {
      // Offline: the next save retries, so failures stay quiet unless we
      // were previously syncing fine.
      if (!offline) toast("Couldn't sync — will retry on your next duel");
      offline = true;
    } finally {
      pushing = false;
    }
  }

  function schedulePush(delayMs) {
    if (!window.PRAuth || !window.PRAuth.user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, delayMs == null ? 1500 : delayMs);
  }

  document.addEventListener("pr:signedin", pullAndMerge);
  document.addEventListener("pr:signedout", () => {
    clearTimeout(pushTimer);
    rev = 0;
    offline = false;
  });

  // ---------- global ranking ----------

  let globalCache = null;

  async function getGlobal(force) {
    if (!force && globalCache && Date.now() - globalCache.at < 60000) {
      return globalCache.data;
    }
    const out = await api("/api/global");
    if (!out.ok) throw new Error("global unavailable");
    globalCache = { at: Date.now(), data: out.data };
    return out.data;
  }

  window.PRSync = { onSave: () => schedulePush(), pullAndMerge, push };
  window.PRGlobal = { get: getGlobal };

  // Sign-in state from a previous visit: pull once the session check lands.
  if (window.PRAuth && window.PRAuth.ready) {
    window.PRAuth.ready.then(() => {
      if (window.PRAuth.user) pullAndMerge();
    });
  }
})();
