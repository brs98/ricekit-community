// ==UserScript==
// @name         Ricekit Linear Theme
// @namespace    ricekit
// @match        https://linear.app/*
// @run-at       document-start
// @grant        none
// @version      0.1.0
// @description  Apply the active Ricekit palette as Linear's native custom theme.
// @noframes
// ==/UserScript==

// Linear has a built-in "Custom" interface theme that accepts a JSON shape:
//   { base: [L,C,H,A], accent: [L,C,H,A], contrast, sidebar?: {base,accent,contrast}, colorFormat: 'RGB' }
// where the LCH arrays are CIE LCH (L 0–100, A 0–1). When set, Linear derives
// every --sx-* and --bg-* variable in the app from those two colors.
//
// This script grabs Linear's UserSettings MobX model and writes the theme
// directly — no Settings page, no UI flicker, no clipboard. The hook strategy
// is structured to survive Linear's frequent bundle renames:
//
//   1) Install an Object.prototype setter sentinel at document-start on a
//      property the UserSettings constructor assigns (`toggleNotificationBadge`,
//      a stable name because MobX persists actions by name string). When fired,
//      verify the instance has `setCurrentCustomTheme` on its prototype chain.
//   2) From any captured instance, navigate `instance.store.user.settings` to
//      get the LIVE UserSettings (the sentinel-captured one is the bootstrap
//      copy that gets superseded by server hydration).
//   3) Read --rk-* CSS vars off :root via a probe element (resolves
//      relative-color expressions like oklch(from var(--rk-background) ...)).
//   4) Normalize each color through a 1×1 canvas to sRGB, then convert
//      sRGB→linear→XYZ→Lab→LCH.
//   5) Compare with the currently-applied theme and apply only on diff.
//
// All names referenced (toggleNotificationBadge, setCurrentCustomTheme,
// customThemes, theme, save, store, user, settings) are MobX action / model
// field names that Linear's minifier preserves because they're persisted to
// the server by name.

(() => {
  if (window.__ricekitLinearTheme) return; // double-load guard
  const dbg = window.__ricekitLinearTheme = { state: 'init', anchor: false, applied: false, errors: [], lastTheme: null };

  // ─── 1. document-start: capture a UserSettings instance ────────────────────
  // We don't need the *active* one here — any instance lets us reach the live
  // store via `.store.user.settings`. The sentinel captures the very first
  // UserSettings constructed during bootstrap.
  let anchor = null;
  const SENTINEL_NAMES = [
    'toggleNotificationBadge',  // primary; Linear's "Show notification badge" pref
    'toggleDebugApplicationStore',
    'toggleDebugNavigation',
  ];
  const cleanupSentinels = [];
  for (const name of SENTINEL_NAMES) {
    Object.defineProperty(Object.prototype, name, {
      configurable: true,
      set(value) {
        // Always create the real own-property so the constructor's assignment
        // takes effect. (Forgetting this breaks Linear.)
        Object.defineProperty(this, name, { value, writable: true, configurable: true, enumerable: true });
        if (anchor) return;
        // Walk the prototype chain looking for setCurrentCustomTheme — that's
        // the discriminator that says "this instance is UserSettings".
        let p = this, depth = 0;
        while (p && depth < 8) {
          const desc = Object.getOwnPropertyDescriptor(p, 'setCurrentCustomTheme');
          if (desc && typeof desc.value === 'function') {
            anchor = this;
            dbg.anchor = true;
            dbg.anchorVia = name;
            cleanupSentinels.forEach((fn) => fn());
            return;
          }
          p = Object.getPrototypeOf(p);
          depth++;
        }
      },
      get() { return undefined; },
    });
    cleanupSentinels.push(() => { try { delete Object.prototype[name]; } catch {} });
  }

  // ─── 2. utilities ─────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // sRGB-byte → CIE LCH (D65), returns [L, C, H, A] with L on 0–100.
  const srgbToLch = (r, g, b, a) => {
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const R = lin(r), G = lin(g), B = lin(b);
    // sRGB → XYZ (D65)
    const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
    const Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
    const Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041;
    // XYZ → Lab (D65 reference white)
    const xn = X / 0.95047, yn = Y / 1.00000, zn = Z / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(xn), fy = f(yn), fz = f(zn);
    const L = 116 * fy - 16;
    const A = 500 * (fx - fy);
    const Bb = 200 * (fy - fz);
    // Lab → LCH
    const C = Math.sqrt(A * A + Bb * Bb);
    let H = (Math.atan2(Bb, A) * 180) / Math.PI;
    if (H < 0) H += 360;
    return [L, C, H, a / 255];
  };

  // Normalize ANY CSS color string (rgb, oklch, hex, named, etc.) to LCH via a
  // 1×1 canvas. The browser handles all parsing — we just read the sRGB output.
  const cssColorToLch = (() => {
    let canvas, ctx;
    return (cssColor) => {
      if (!canvas) { canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; ctx = canvas.getContext('2d', { willReadFrequently: true }); }
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = cssColor; // browser silently rejects invalid colors, leaving #000
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return srgbToLch(r, g, b, a);
    };
  })();

  // Read a CSS custom property by painting it on a hidden probe element and
  // reading the computed color. This resolves relative-color expressions (e.g.
  // oklch(from var(--rk-background) calc(l - 0.03) c h)) for free.
  const readVarColor = (() => {
    let probe;
    return (varName) => {
      if (!probe) {
        probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;left:-9999px;width:0;height:0;opacity:0;';
        document.documentElement.appendChild(probe);
      }
      probe.style.color = '';
      probe.style.color = `var(${varName})`;
      const c = getComputedStyle(probe).color;
      return c && c !== 'rgba(0, 0, 0, 0)' ? c : null;
    };
  })();

  // Round LCH to 4 decimals so equality checks and JSON output stay stable.
  const round4 = (n) => Math.round(n * 10000) / 10000;
  const roundLch = (a) => a.map(round4);
  const sameLch = (a, b) => a && b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.01);
  const sameTheme = (a, b) => {
    if (!a || !b) return false;
    if (!sameLch(a.base, b.base) || !sameLch(a.accent, b.accent)) return false;
    if (a.contrast !== b.contrast) return false;
    const sa = a.sidebar, sb = b.sidebar;
    if (!sa !== !sb) return false;
    if (sa && sb) {
      if (!sameLch(sa.base, sb.base) || !sameLch(sa.accent, sb.accent)) return false;
      if (sa.contrast !== sb.contrast) return false;
    }
    return true;
  };

  // ─── 3. build theme JSON from rk vars ─────────────────────────────────────
  const buildTheme = () => {
    const bgCss = readVarColor('--rk-background');
    const accentCss = readVarColor('--rk-accent');
    if (!bgCss || !accentCss) return null;
    // Sidebar uses the slightly darker mantle. If --rk-mantle isn't defined
    // (older ricekit-vars.css), fall back to background.
    const sidebarBgCss = readVarColor('--rk-mantle') || bgCss;
    return {
      base:    roundLch(cssColorToLch(bgCss)),
      accent:  roundLch(cssColorToLch(accentCss)),
      contrast: 30,
      sidebar: {
        base:   roundLch(cssColorToLch(sidebarBgCss)),
        accent: roundLch(cssColorToLch(accentCss)),
        contrast: 30,
      },
      colorFormat: 'RGB',
    };
  };

  // ─── 4. apply theme to live UserSettings ──────────────────────────────────
  const apply = () => {
    dbg.lastApplyAt = Date.now();
    if (!anchor) { dbg.lastApplyResult = 'no-anchor'; return false; }
    const live = anchor.store?.user?.settings;
    if (!live || typeof live.setCurrentCustomTheme !== 'function') { dbg.lastApplyResult = 'no-live'; return false; }
    dbg.haveLive = true;

    const desired = buildTheme();
    if (!desired) { dbg.lastApplyResult = 'no-rk-vars'; return false; }
    dbg.lastTheme = desired;

    const current = live.currentlySelectedCustomTheme;
    if (live.theme === 'custom' && sameTheme(current, desired)) { dbg.lastApplyResult = 'unchanged'; return true; }

    try {
      live.setCurrentCustomTheme(desired);
      live.theme = 'custom';
      live.save();
      dbg.applied = true;
      dbg.lastApplyResult = 'applied';
      console.info('[ricekit-linear] applied custom theme', desired);
      return true;
    } catch (e) {
      dbg.errors.push(String(e));
      dbg.lastApplyResult = 'error';
      console.warn('[ricekit-linear] apply failed', e);
      return false;
    }
  };

  // ─── 5. wait for store + rk vars, then apply ──────────────────────────────
  // We need (a) the sentinel to have captured an anchor, (b) the rk-vars
  // userstyle to be applied so --rk-* are set on :root, and (c) the live
  // UserSettings to be hydrated (not just the bootstrap copy).
  const waitForReady = async () => {
    const start = Date.now();
    while (Date.now() - start < 30_000) {
      if (anchor && anchor.store?.user?.settings && readVarColor('--rk-background')) return true;
      await sleep(250);
    }
    return false;
  };

  const start = async () => {
    dbg.state = 'waiting';
    if (!(await waitForReady())) {
      dbg.state = 'timed-out';
      dbg.timedOut = { hasAnchor: !!anchor, hasLive: !!anchor?.store?.user?.settings, rkBg: readVarColor('--rk-background') };
      console.warn('[ricekit-linear] timed out waiting for store / rk vars', dbg.timedOut);
      return;
    }
    dbg.state = 'ready';
    apply();
    // Two re-trigger sources:
    // 1) MutationObserver — fast-path for direct element-attribute mutations
    //    (e.g. someone setting an inline style on <html>).
    // 2) Poll — required because rk vars typically change via CSSOM mutations
    //    (Stylus replacing a <style> tag, Firefox userContent.css cascade,
    //    chrome.scripting.insertCSS) which don't surface as DOM events.
    //    `apply()` short-circuits on `sameTheme`, so most polls do no work.
    new MutationObserver(() => apply()).observe(document.documentElement, {
      attributes: true, attributeFilter: ['style', 'class'],
    });
    setInterval(apply, 1000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
