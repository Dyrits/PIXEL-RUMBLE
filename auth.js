// Pixel Rumble account UI (multi-user batch 2). Talks to BetterAuth's REST
// endpoints with plain fetch — the SPA stays zero-dependency. Self-contained:
// injects its header button and modal, exposes window.PRAuth.
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  async function api(path, opts) {
    const res = await fetch(path, {
      method: (opts && opts.method) || "GET",
      headers: { "Content-Type": "application/json" },
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON error body */ }
    if (!res.ok) {
      const msg = data && (data.message || data.error);
      throw new Error(typeof msg === "string" ? msg : "Something went wrong. Try again.");
    }
    return data;
  }

  let user = null;

  function renderHeader() {
    const top = $(".top");
    if (!top) return;
    let btn = document.getElementById("account-btn");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = "account-btn";
      btn.className = "acct-btn";
      const sound = document.getElementById("sound-btn");
      top.insertBefore(btn, sound || null);
    }
    if (user) {
      btn.className = "acct-btn chip";
      btn.textContent = user.name.slice(0, 1).toUpperCase();
      btn.title = `${user.name} · ${user.email} — click to sign out`;
      btn.setAttribute("aria-label", `Account: ${user.name}. Click to sign out.`);
      btn.onclick = async () => {
        try {
          await api("/api/auth/sign-out", { method: "POST", body: {} });
          user = null;
          renderHeader();
          toast("Signed out. Your ladder stays on this device.");
        } catch (err) {
          toast(err.message);
        }
      };
    } else {
      btn.className = "acct-btn";
      btn.textContent = "Sign in";
      btn.title = "Create an account or sign in";
      btn.setAttribute("aria-label", "Sign in");
      btn.onclick = openModal;
    }
  }

  function toast(msg) {
    const node = $("#toast");
    if (!node) return;
    node.textContent = msg;
    node.classList.add("show");
    setTimeout(() => node.classList.remove("show"), 2600);
  }

  let mode = "signin";

  // One place sets the mode's visible state; openModal always resets to
  // sign-in so a leftover sign-up visit can never desync the dialog
  // (form saying "Sign in" while submit still demands a name).
  function setMode(next, body) {
    mode = next;
    const up = mode === "signup";
    body.querySelector("#auth-title").textContent = up ? "Create an account" : "Sign in";
    body.querySelector("#auth-submit").textContent = up ? "Create account" : "Sign in";
    body.querySelector("#auth-toggle").textContent = up
      ? "I already have an account"
      : "New here? Create an account";
    body.querySelector("#auth-name-row").hidden = !up;
    body.querySelector("#auth-pass").autocomplete = up ? "new-password" : "current-password";
    body.querySelector("#auth-error").textContent = "";
  }

  function openModal() {
    closeModal();
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.id = "auth-overlay";
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

    const panel = document.createElement("div");
    panel.className = "panel auth-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Sign in to Pixel Rumble");

    const close = document.createElement("button");
    close.type = "button";
    close.className = "panel-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "\u00d7";
    close.addEventListener("click", closeModal);
    panel.appendChild(close);

    const body = document.createElement("div");
    body.className = "panel-body";
    body.innerHTML = `
      <h3 id="auth-title">Sign in</h3>
      <p class="panel-sub">Your ladder lives in this browser. Sign in to carry it across devices.</p>
      <form id="auth-form" novalidate>
        <label class="auth-field" id="auth-name-row" hidden>
          <span>Name</span>
          <input type="text" id="auth-name" autocomplete="nickname" maxlength="40">
        </label>
        <label class="auth-field">
          <span>Email</span>
          <input type="email" id="auth-email" autocomplete="email" required>
        </label>
        <label class="auth-field">
          <span>Password</span>
          <input type="password" id="auth-pass" autocomplete="current-password" minlength="8" required>
        </label>
        <p class="auth-error" id="auth-error" role="alert"></p>
        <button type="submit" class="btn auth-submit" id="auth-submit">Sign in</button>
      </form>
      <button type="button" class="auth-switch" id="auth-toggle">New here? Create an account</button>`;

    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const toggle = body.querySelector("#auth-toggle");
    const pass = body.querySelector("#auth-pass");

    setMode("signin", body);

    toggle.addEventListener("click", () => {
      setMode(mode === "signin" ? "signup" : "signin", body);
    });

    body.querySelector("#auth-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = body.querySelector("#auth-error");
      errEl.textContent = "";
      const email = body.querySelector("#auth-email").value.trim();
      const password = pass.value;
      const name = body.querySelector("#auth-name").value.trim();
      try {
        if (mode === "signup") {
          if (!name) throw new Error("Pick a name for the ladder owner.");
          await api("/api/auth/sign-up/email", { method: "POST", body: { email, password, name } });
          user = (await api("/api/me")).user;
          toast(`Welcome, ${user.name}.`);
        } else {
          await api("/api/auth/sign-in/email", { method: "POST", body: { email, password } });
          user = (await api("/api/me")).user;
          toast(`Signed in as ${user.name}.`);
        }
        closeModal();
        renderHeader();
      } catch (err) {
        errEl.textContent = err.message;
      }
    });

    (body.querySelector(mode === "signup" ? "#auth-name" : "#auth-email")).focus();
  }

  function closeModal() {
    const node = document.getElementById("auth-overlay");
    if (node) node.remove();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  async function boot() {
    try {
      const me = await api("/api/me");
      user = me.user;
    } catch (e) { user = null; }
    renderHeader();
  }

  window.PRAuth = { boot, refresh: boot, get user() { return user; } };
  boot();
})();
