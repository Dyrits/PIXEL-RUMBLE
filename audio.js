// Pixel Rumble sound: a tiny WebAudio synth for arcade feedback.
// No assets, no libraries; the AudioContext is created lazily on first play
// so browsers' autoplay policies stay satisfied.
(function () {
  "use strict";

  let ctx = null;
  let muted = false;

  function ensure() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        ctx = null;
      }
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, at, dur, type, vol) {
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || "square";
    osc.frequency.value = freq;
    const v = vol || 0.05;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(v, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const fx = {
    // Coin-pick: two quick rising blips.
    pick() {
      tone(660, 0, 0.08);
      tone(990, 0.07, 0.12);
    },
    // Soft neutral shuffle.
    skip() {
      tone(330, 0, 0.06, "triangle", 0.04);
      tone(294, 0.05, 0.07, "triangle", 0.035);
    },
    // Downward: taking a duel back.
    undo() {
      tone(523, 0, 0.07, "square", 0.04);
      tone(392, 0.06, 0.1, "square", 0.04);
    },
    // Menu tick.
    tick() {
      tone(880, 0, 0.04, "square", 0.03);
    },
    // New match appears in a bracket.
    match() {
      tone(587, 0, 0.05, "square", 0.035);
      tone(784, 0.05, 0.06, "square", 0.035);
    },
    // Champion fanfare.
    champ() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.16, "square", 0.05));
      tone(1319, 0.42, 0.3, "square", 0.045);
    },
  };

  window.PRAudio = {
    play(name) {
      if (muted) return;
      if (!ensure()) return;
      (fx[name] || fx.tick)();
    },
    setMuted(m) {
      muted = m;
    },
    isMuted() {
      return muted;
    },
  };
})();
