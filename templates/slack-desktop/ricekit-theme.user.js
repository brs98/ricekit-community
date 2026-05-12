// ==UserScript==
// @name         Ricekit Slack Theme
// @namespace    ricekit
// @match        https://app.slack.com/*
// @run-at       document-start
// @grant        none
// @version      0.1.0
// @description  Apply the active Ricekit palette to Slack at runtime by harvesting Slack's stylesheets and emitting palette-driven overrides.
// ==/UserScript==

// Slack uses emotion/styled-components with hashed class names that rotate on
// every production build, so a static userstyle goes stale fast. This script
// runs the harvest live in the renderer:
//
//   1) wait for --rk-* vars to land on :root (Stylus userstyle in browser, or
//      ricekit-vars.css insertCSS'd in the desktop electron build).
//   2) walk every CSSStyleSheet (incl. adoptedStyleSheets, incl. nested
//      @media/@supports), classify each declaration, and emit a palette-driven
//      override into a singleton <style id="ricekit-slack"> tag.
//   3) MutationObserver on the whole document tree re-runs the harvest when
//      Slack lazy-loads a chunk (emoji picker, huddle UI, etc.). Styles can
//      land anywhere — head chunks, body portals, deeply nested wrappers.
//   4) sheet-count poll catches mutations the DOM doesn't expose: insertRule
//      on existing sheets (emotion/styled-components), adoptedStyleSheets
//      pushes, late-bind cssRules after an async <link> finishes loading.
//   5) palette poll re-runs when --rk-* vars change (Stylus theme switch, or
//      ricekit-vars.css hot-reload from the desktop integration).
//
// Transparency preservation rules (the reason this exists, not a static dump):
//   - rgba(0,0,0,α<1)   → color-mix(in oklch, var(--rk-crust)      α%, transparent)
//   - rgba(255,255,255,α<1) → color-mix(in oklch, var(--rk-foreground) α%, transparent)
//   - rgba(<chromatic>,α<1) → color-mix(in oklch, var(--rk-<hue>)  α%, transparent)
//   - rgba(<neutral>, α<1) → color-mix on the lightness-band fallback
//   - rgba(*, 1)          → opaque palette pick by lightness band, no inversion
//   - rgba(0,0,0,0)       → drop, never emit
//
// In-renderer debug: `window.__ricekitSlackTheme`.

(() => {
  if (window.__ricekitSlackTheme) return;
  const dbg = window.__ricekitSlackTheme = {
    state: 'init', harvestCount: 0, lastHarvestMs: 0, lastStats: null,
    errors: [], lastPaletteHash: '',
  };

  // ─── 1. palette readiness ─────────────────────────────────────────────────
  const RK_VARS = [
    '--rk-foreground', '--rk-background', '--rk-accent',
    '--rk-surface', '--rk-surface0', '--rk-surface1',
    '--rk-border', '--rk-muted',
    '--rk-mantle', '--rk-crust',
    '--rk-overlay0', '--rk-overlay1', '--rk-overlay2',
    '--rk-red', '--rk-green', '--rk-yellow',
    '--rk-blue', '--rk-cyan', '--rk-magenta', '--rk-peach',
    '--rk-flamingo', '--rk-rosewater',
    '--rk-bright-green', '--rk-bright-yellow', '--rk-bright-white',
  ];
  const readPalette = () => {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    for (const v of RK_VARS) out[v] = cs.getPropertyValue(v).trim();
    return out;
  };
  const paletteHash = (p) => RK_VARS.map((v) => p[v]).join('|');
  const isPaletteReady = (p) => !!p['--rk-foreground'] && !!p['--rk-background'];

  // ─── 2. semantic token mapping (--dt_color-*) ─────────────────────────────
  const semanticTheme = (name) => {
    if (name === '--dt_color-theme-content-imp') return 'var(--rk-crust)';
    if (name === '--dt_color-theme-content-inv-pry') return 'var(--rk-foreground)';
    if (name === '--dt_color-theme-content-inv-sec') return 'var(--rk-overlay2)';
    if (name === '--dt_color-theme-content-inv-ter') return 'var(--rk-muted)';
    if (name === '--dt_color-theme-base-inv-pry') return 'var(--rk-mantle)';
    if (name === '--dt_color-theme-base-inv-sec') return 'var(--rk-surface0)';
    if (/^--dt_color-theme-surf-inv-(pry|sec|ter)$/.test(name)) {
      const step = name.endsWith('-pry') ? 6 : name.endsWith('-sec') ? 10 : 18;
      return `color-mix(in oklch, var(--rk-foreground) ${step}%, transparent)`;
    }
    return semanticCore(name.replace('--dt_color-theme-', '--dt_color-'));
  };
  const semanticCore = (name) => {
    if (name === '--dt_color-base-pry') return 'var(--rk-background)';
    if (name === '--dt_color-base-sec') return 'var(--rk-mantle)';
    if (name === '--dt_color-base-ter') return 'var(--rk-crust)';
    if (name === '--dt_color-base-imp') return 'var(--rk-red)';
    if (name === '--dt_color-base-hgl-1') return 'color-mix(in oklch, var(--rk-accent) 15%, var(--rk-background))';
    if (name === '--dt_color-base-hgl-2') return 'color-mix(in oklch, var(--rk-green) 15%, var(--rk-background))';
    if (name === '--dt_color-base-hgl-3') return 'color-mix(in oklch, var(--rk-yellow) 15%, var(--rk-background))';
    if (name === '--dt_color-base-inv-pry') return 'var(--rk-foreground)';
    if (name === '--dt_color-base-inv-hgl-1') return 'var(--rk-accent)';
    if (name === '--dt_color-base-inv-hgl-2') return 'var(--rk-green)';
    if (name === '--dt_color-base-inv-hgl-3') return 'var(--rk-yellow)';
    if (name === '--dt_color-base-inv-imp') return 'var(--rk-red)';
    if (name === '--dt_color-base-modal') return 'color-mix(in oklch, var(--rk-crust) 65%, transparent)';
    if (/^--dt_color-base-(pry|sec|ter)-hover$/.test(name)) return 'color-mix(in oklch, var(--rk-foreground) 8%, transparent)';
    if (/^--dt_color-base-(pry|sec|ter)-pressed$/.test(name)) return 'color-mix(in oklch, var(--rk-foreground) 18%, transparent)';
    if (name === '--dt_color-content-pry') return 'var(--rk-foreground)';
    if (name === '--dt_color-content-sec') return 'var(--rk-overlay2)';
    if (name === '--dt_color-content-ter') return 'var(--rk-muted)';
    if (name === '--dt_color-content-imp') return 'var(--rk-red)';
    if (name === '--dt_color-content-hgl-1') return 'var(--rk-accent)';
    if (name === '--dt_color-content-hgl-2') return 'var(--rk-green)';
    if (name === '--dt_color-content-hgl-3') return 'var(--rk-yellow)';
    if (name === '--dt_color-content-inv-pry') return 'var(--rk-crust)';
    if (name === '--dt_color-content-inv-sec') return 'var(--rk-mantle)';
    if (name === '--dt_color-content-inv-ter') return 'var(--rk-border)';
    if (name === '--dt_color-content-inv-imp') return 'var(--rk-red)';
    if (name === '--dt_color-content-inv-hgl-1') return 'var(--rk-accent)';
    if (name === '--dt_color-content-inv-hgl-2') return 'var(--rk-green)';
    if (name === '--dt_color-content-inv-hgl-3') return 'var(--rk-yellow)';
    if (name === '--dt_color-surf-pry') return 'color-mix(in oklch, var(--rk-foreground) 6%, transparent)';
    if (name === '--dt_color-surf-sec') return 'color-mix(in oklch, var(--rk-foreground) 10%, transparent)';
    if (name === '--dt_color-surf-imp') return 'color-mix(in oklch, var(--rk-red) 15%, transparent)';
    if (name === '--dt_color-surf-hgl-1') return 'color-mix(in oklch, var(--rk-accent) 15%, transparent)';
    if (name === '--dt_color-surf-hgl-2') return 'color-mix(in oklch, var(--rk-green) 15%, transparent)';
    if (name === '--dt_color-surf-hgl-3') return 'color-mix(in oklch, var(--rk-yellow) 15%, transparent)';
    if (/^--dt_color-surf-inv/.test(name)) return 'color-mix(in oklch, var(--rk-crust) 10%, transparent)';
    if (name === '--dt_color-otl-pry') return 'var(--rk-border)';
    if (name === '--dt_color-otl-sec') return 'color-mix(in oklch, var(--rk-border) 70%, transparent)';
    if (name === '--dt_color-otl-ter') return 'color-mix(in oklch, var(--rk-border) 50%, transparent)';
    if (name === '--dt_color-otl-imp') return 'var(--rk-red)';
    if (name === '--dt_color-otl-hgl-1') return 'var(--rk-accent)';
    if (name === '--dt_color-otl-hgl-2') return 'var(--rk-green)';
    if (name === '--dt_color-otl-hgl-3') return 'var(--rk-yellow)';
    if (/^--dt_color-otl-inv/.test(name)) return 'color-mix(in oklch, var(--rk-foreground) 20%, transparent)';
    if (name === '--dt_color-ctr-pry') return 'var(--rk-surface0)';
    if (name === '--dt_color-ctr-sec') return 'var(--rk-mantle)';
    if (name === '--dt_color-brand-core-slack-green') return 'var(--rk-green)';
    if (name === '--dt_color-brand-core-slack-red') return 'var(--rk-red)';
    if (name === '--dt_color-brand-core-black') return 'var(--rk-crust)';
    const brandSecMap = {
      berry: '--rk-red', bubblegum: '--rk-magenta', crimson: '--rk-red', salmon: '--rk-flamingo',
      mauve: '--rk-magenta', terracotta: '--rk-peach', peach: '--rk-peach', sandbar: '--rk-yellow',
      legal: '--rk-yellow', moss: '--rk-green', evergreen: '--rk-green', teal: '--rk-cyan',
      pool: '--rk-cyan', cobalt: '--rk-blue', 'bright-aubergine': '--rk-magenta',
      'small-text': '--rk-muted', text: '--rk-foreground',
      'bg-gray': '--rk-surface', 'inactive-gray': '--rk-muted',
    };
    const bsm = name.match(/^--dt_color-brand-sec-(.+)$/);
    if (bsm && brandSecMap[bsm[1]]) return `var(${brandSecMap[bsm[1]]})`;
    if (name === '--dt_color-constants-white') return 'var(--rk-foreground)';
    if (name === '--dt_color-constants-black') return 'var(--rk-crust)';
    const otlSec = name.match(/^--dt_color-otl-(hgl-[123]|imp)-sec$/);
    if (otlSec) {
      const base = otlSec[1].startsWith('hgl-')
        ? ({ 'hgl-1': 'accent', 'hgl-2': 'green', 'hgl-3': 'yellow' })[otlSec[1]]
        : 'red';
      return `color-mix(in oklch, var(--rk-${base}) 50%, transparent)`;
    }
    const hp = name.match(/^(--dt_color-[a-z-]+?(?:-[a-z0-9]+)?)-(hover|pressed)$/);
    if (hp) {
      const baseMapped = semanticCore(hp[1]);
      if (!baseMapped) return null;
      const bump = hp[2] === 'pressed' ? 14 : 8;
      return `color-mix(in oklch, ${baseMapped} ${100 - bump}%, var(--rk-foreground) ${bump}%)`;
    }
    return null;
  };
  const semantic = (name) =>
    name.startsWith('--dt_color-theme-') ? semanticTheme(name) : semanticCore(name);

  // ─── 3. Slack token (--sk_*, --dt_color-plt-*) → rk var ───────────────────
  const skToRk = {
    '--sk_primary_background':   '--rk-background',
    '--sk_foreground_min_solid': '--rk-mantle',
    '--sk_foreground_min':       '--rk-crust',
    '--sk_primary_foreground':   '--rk-foreground',
    '--sk_foreground_max':       '--rk-foreground',
    '--sk_foreground_max_solid': '--rk-foreground',
    '--sk_foreground_high':      '--rk-foreground',
    '--sk_foreground_high_solid':'--rk-overlay2',
    '--sk_foreground_mid':       '--rk-overlay2',
    '--sk_foreground_mid_solid': '--rk-muted',
    '--sk_foreground_low':       '--rk-muted',
    '--sk_foreground_low_solid': '--rk-border',
    '--sk_foreground_soft':      '--rk-foreground',
    '--sk_foreground_soft_solid':'--rk-surface0',
    '--sk_highlight':            '--rk-accent',
    '--sk_highlight_hover':      '--rk-accent',
    '--sk_highlight_accent':     '--rk-accent',
    '--sk_inverted_foreground':  '--rk-crust',
    '--sk_inverted_background':  '--rk-foreground',
    '--sk_raspberry_red':        '--rk-red',
    '--sk_secondary_highlight':  '--rk-yellow',
    '--sk_secondary_foreground': '--rk-muted',
  };
  const SCALE_TO_RK = [
    { max: 7,   rk: '--rk-crust' },
    { max: 17,  rk: '--rk-mantle' },
    { max: 25,  rk: '--rk-background' },
    { max: 45,  rk: '--rk-surface' },
    { max: 55,  rk: '--rk-border' },
    { max: 65,  rk: '--rk-muted' },
    { max: 85,  rk: '--rk-overlay2' },
    { max: 101, rk: '--rk-foreground' },
  ];
  const FAMILY_TO_RK = {
    primary: null, gray: null,
    aubergine: '--rk-magenta', indigo: '--rk-magenta', purple: '--rk-magenta',
    jade: '--rk-green', cilantro: '--rk-bright-green', mint: '--rk-bright-green',
    lagoon: '--rk-cyan', ocean: '--rk-blue', blue: '--rk-blue',
    campfire: '--rk-peach', flamingo: '--rk-flamingo',
    honeycomb: '--rk-yellow', sunflower: '--rk-bright-yellow',
    horchata: '--rk-bright-white',
    raspberry: '--rk-red', tomato: '--rk-red', rose: '--rk-rosewater',
    cyan: '--rk-cyan', pink: '--rk-magenta',
  };
  // Maps Slack's `--dt_color-plt-<family>-<scale>` to a CSS color expression.
  // For chromatic families we preserve hue+chroma from the family rk var and
  // derive lightness from the scale via `oklch(from <var> L c h)`. This keeps
  // within-family contrast (e.g. aubergine-20 bubble + aubergine-90 glyph) that
  // a flat family→rk-var map would collapse to one color. Gray/primary fall
  // through to the lightness-band SCALE_TO_RK.
  const pltToRk = (name) => {
    const m = name.match(/^--dt_color-plt-([a-z_]+)-(\d+)$/);
    if (!m) return null;
    const family = m[1];
    const scale = parseInt(m[2], 10);
    if (family in FAMILY_TO_RK) {
      const explicit = FAMILY_TO_RK[family];
      if (explicit) {
        const L = (0.06 + scale / 100 * 0.88).toFixed(3);
        return `oklch(from var(${explicit}) ${L} c h)`;
      }
    }
    for (const row of SCALE_TO_RK) if (scale <= row.max) return `var(${row.rk})`;
    return 'var(--rk-foreground)';
  };
  const tokenToRk = (name) => {
    if (name.startsWith('--sk_')) return skToRk[name] ? `var(${skToRk[name]})` : null;
    if (name.startsWith('--dt_color-plt-')) return pltToRk(name);
    return null;
  };

  // Rewrite a CSS value containing tokenized var() references into palette-
  // driven equivalents. Slack wraps tokens in `rgba(var(--TOKEN), α)` — CSS
  // can't extract the channels, so we route through `rgb(from var(--rk-Y) r g
  // b / α)` to keep Slack's intended alpha while sourcing the color from the
  // active palette. Bare var() and rgb(var()) collapse to var(--rk-Y).
  const TOKEN_RE = /(--sk_[a-zA-Z0-9_-]+|--dt_color-plt-[a-zA-Z0-9_-]+)/;
  const rewriteSkValue = (val) => {
    if (!TOKEN_RE.test(val)) return null;
    let out = val, changed = false;
    out = out.replace(
      /rgba?\(\s*var\(\s*(--sk_[a-zA-Z0-9_-]+|--dt_color-plt-[a-zA-Z0-9_-]+)(?:\s*,[^()]*)?\)\s*,\s*([^)]+)\)/g,
      (_, tok, alpha) => {
        const rk = tokenToRk(tok);
        if (!rk) return _;
        changed = true;
        return `rgb(from ${rk} r g b / ${alpha.trim()})`;
      },
    );
    out = out.replace(
      /rgba?\(\s*var\(\s*(--sk_[a-zA-Z0-9_-]+|--dt_color-plt-[a-zA-Z0-9_-]+)(?:\s*,[^()]*)?\)\s*\)/g,
      (_, tok) => { const rk = tokenToRk(tok); if (!rk) return _; changed = true; return rk; },
    );
    out = out.replace(
      /var\(\s*(--sk_[a-zA-Z0-9_-]+|--dt_color-plt-[a-zA-Z0-9_-]+)(?:\s*,[^)]+)?\)/g,
      (_, tok) => { const rk = tokenToRk(tok); if (!rk) return _; changed = true; return rk; },
    );
    return changed ? out : null;
  };

  // ─── 4. transparency-preserving literal mapper ────────────────────────────
  const hexToRgb = (hex) => {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 6) h += 'ff';
    if (h.length !== 8) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16)];
  };
  const luminance = ([r, g, b]) => {
    const ch = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const rgbOf = (val) => {
    let m = val.match(/#[0-9a-fA-F]{3,8}\b/);
    if (m) return hexToRgb(m[0]);
    m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d*\.?\d+))?\s*\)/);
    if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4] ? Math.round(parseFloat(m[4]) * 255) : 255];
    return null;
  };
  const pickAccentByHue = (r, g, b) => {
    if (r > 200 && g < 140 && b < 140) return '--rk-red';
    if (g > 180 && r < 160) return '--rk-green';
    if (r > 200 && g > 180 && b < 160) return '--rk-yellow';
    if (b > 200 && r < 180) return '--rk-accent';
    return '--rk-accent';
  };
  const pickByLightnessBand = (L) => {
    if (L < 0.02) return 'var(--rk-crust)';
    if (L < 0.06) return 'var(--rk-background)';
    if (L < 0.10) return 'var(--rk-mantle)';
    if (L < 0.18) return 'var(--rk-surface0)';
    if (L < 0.28) return 'var(--rk-surface1)';
    if (L < 0.42) return 'var(--rk-border)';
    if (L < 0.60) return 'var(--rk-muted)';
    if (L < 0.80) return 'var(--rk-overlay2)';
    return 'var(--rk-foreground)';
  };
  const fmtPct = (alpha) => {
    const n = Number(alpha) * 100;
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
  };
  const mapLiteral = (val) => {
    const rgba = rgbOf(val);
    if (!rgba) return null;
    const [r, g, b, a255] = rgba;
    const alpha = a255 / 255;
    if (alpha === 0) return null; // fully transparent — never emit
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    // RULE 1: pure black overlay → darken via crust, preserve α
    if (alpha < 1 && r < 12 && g < 12 && b < 12) {
      return `color-mix(in oklch, var(--rk-crust) ${fmtPct(alpha)}%, transparent)`;
    }
    // RULE 2: pure white overlay → lift via foreground, preserve α
    if (alpha < 1 && r > 243 && g > 243 && b > 243) {
      return `color-mix(in oklch, var(--rk-foreground) ${fmtPct(alpha)}%, transparent)`;
    }
    // RULE 3: chromatic translucent → palette accent by hue, preserve α
    if (alpha < 1 && chroma > 100) {
      return `color-mix(in oklch, var(${pickAccentByHue(r, g, b)}) ${fmtPct(alpha)}%, transparent)`;
    }
    // RULE 4: opaque → lightness-band pick; no light-theme inversion (input is dark)
    if (alpha === 1) {
      if (chroma > 100) return `var(${pickAccentByHue(r, g, b)})`;
      return pickByLightnessBand(luminance([r, g, b]));
    }
    // RULE 5: mid-alpha neutral → band pick + α
    const band = chroma > 100
      ? `var(${pickAccentByHue(r, g, b)})`
      : pickByLightnessBand(luminance([r, g, b]));
    return `color-mix(in oklch, ${band} ${fmtPct(alpha)}%, transparent)`;
  };
  const mapValue = (val) =>
    val.replace(
      /(#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*\d*\.?\d+)?\s*\))/g,
      (m) => mapLiteral(m) || m,
    );

  // ─── 5. selector skip-list (decorative content we never repaint) ──────────
  // Each entry is matched as a substring against the full selector text, so
  // 'preview' will skip any selector containing the literal string 'preview'
  // (e.g. `.p-link_preview`, `.gif-preview`, `[data-preview]`). The coarseness
  // is intentional — Slack's class names rotate often enough that a precise
  // boundary match would go stale, and a false-positive skip here is much
  // less noticeable than a recolored emoji or filetype glyph.
  //
  // Note on emoji entries: we skip `c-emoji` (the glyph component block + its
  // BEM children: `c-emoji__image`, `c-emoji--small`, etc.) but NOT a generic
  // `emoji` substring. The latter would also skip the picker chrome
  // (`p-emoji_picker__*`), which we want themed. Different BEM prefix —
  // `c-` (component glyph) vs `p-` (page chrome) — keeps the two apart.
  const SKIP = [
    'skin_tone', 'skin-tone', 'filetype', 'file-type',
    'c-icon--file', 'c-icon__file', 'c-icon--figma', 'c-icon--photoshop',
    'c-icon--illustrator', 'c-icon--pdf', 'c-icon--sketch', 'c-icon--adobe',
    'c-icon--indesign', 'c-emoji',
    'brand-', 'brand_',
    'animation', 'p-shouty', 'p-rooster', 'gif_picker', 'c-gif',
    'preview', 'p-pillow_file', 'p-sales_dashboard',
    'c-avatar_color', 'c-reaction', 'c-ladybug',
    'p-celebration', 'p-party_hat', 'color-picker',
    'p-slackbot', 'p-upgrades_icon', 'p-welcome', 'p-setup', 'p-confetti',
  ];
  const shouldSkip = (sel) => SKIP.some((p) => sel.includes(p));

  // ─── 6. harvest pass ──────────────────────────────────────────────────────
  const harvest = () => {
    const t0 = performance.now();
    const rootVars = new Map(), darkVars = new Map();
    const skRules = [], literalRules = [], shadowRules = [];
    // De-dupe key: same (selector, property) only emits once. var-path runs
    // first so it wins over the literal fallback.
    const seenSelProp = new Set();

    const VAR_PROPS = [
      'background', 'color', 'border', 'border-color',
      'border-top', 'border-right', 'border-bottom', 'border-left',
      'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
      'outline', 'outline-color', 'fill', 'stroke', 'caret-color', 'text-decoration-color',
    ];
    const LIT_PROPS = ['background-color', 'background', 'color', 'border-color', 'border', 'fill', 'stroke'];

    const walk = (sheet) => {
      let rules;
      try { rules = sheet.cssRules; } catch { return; }
      if (!rules) return;
      for (const rule of rules) {
        // @media / @supports / @container — recurse into nested cssRules
        if (rule.cssRules && !rule.selectorText) { walk(rule); continue; }
        if (!rule.style || !rule.selectorText) continue;
        const sel = rule.selectorText.trim();

        // Semantic token harvest from :root / .sk-client-theme--dark
        if (sel === ':root' || sel === '.sk-client-theme--dark') {
          const bucket = sel === ':root' ? rootVars : darkVars;
          for (let i = 0; i < rule.style.length; i++) {
            const p = rule.style[i];
            if (!p.startsWith('--dt_color-')) continue;
            const m = semantic(p);
            if (m) bucket.set(p, m);
          }
          continue;
        }

        if (shouldSkip(sel)) continue;

        // Token-driven rewrites: --sk_* and --dt_color-plt-*. Iterate
        // enumerated props plus an explicit shorthand probe — Slack writes
        // `background: rgba(var(--sk_X), 1)` which CSSStyleDeclaration
        // sometimes splits into empty sub-properties.
        const seen = new Set();
        for (let i = 0; i < rule.style.length; i++) {
          const p = rule.style[i];
          const v = rule.style.getPropertyValue(p);
          if (v) seen.add(`${p} ${v}`);
          if (!v || (!v.includes('--sk_') && !v.includes('--dt_color-plt-'))) continue;
          const nv = rewriteSkValue(v);
          if (!nv) continue;
          const key = `${sel}\n${p}`;
          if (seenSelProp.has(key)) continue;
          seenSelProp.add(key);
          skRules.push({ sel, prop: p, mapped: nv });
        }
        for (const p of VAR_PROPS) {
          const v = rule.style.getPropertyValue(p);
          if (!v || !v.includes('--sk_') || seen.has(`${p} ${v}`)) continue;
          const nv = rewriteSkValue(v);
          if (!nv) continue;
          const key = `${sel}\n${p}`;
          if (seenSelProp.has(key)) continue;
          seenSelProp.add(key);
          skRules.push({ sel, prop: p, mapped: nv });
        }

        // Literal hex/rgb fallback — only for rules that have NO var() ref,
        // and only at (sel, prop) keys not already covered by a var rewrite.
        for (const prop of LIT_PROPS) {
          const v = rule.style.getPropertyValue(prop);
          if (!v || /var\(/.test(v) || !/(#[0-9a-fA-F]{3,}|rgba?\()/.test(v)) continue;
          const key = `${sel}\n${prop}`;
          if (seenSelProp.has(key)) continue;
          const nv = mapValue(v);
          if (nv === v) continue;
          seenSelProp.add(key);
          literalRules.push({ sel, prop, mapped: nv });
        }

        // Box-shadow — rewrite token refs and/or literal segments inside it.
        const sh = rule.style.getPropertyValue('box-shadow');
        if (sh) {
          let nv = sh;
          if (nv.includes('--sk_') || nv.includes('--dt_color-plt-')) nv = rewriteSkValue(nv) || nv;
          if (/(#[0-9a-fA-F]{3,}|rgba?\()/.test(nv)) nv = mapValue(nv);
          if (nv !== sh) shadowRules.push({ sel, mapped: nv });
        }
      }
    };

    try {
      for (const sheet of document.styleSheets) walk(sheet);
      for (const sheet of document.adoptedStyleSheets || []) walk(sheet);
    } catch (e) {
      dbg.errors.push({ phase: 'walk', msg: String(e) });
    }

    // Layered output. Order matters — last-wins. The hand-written core block
    // lands LAST so the explicit transparency rules for modal/popover/menu
    // override any auto-harvested rule that targets the same selector.
    const root = [':root {'];
    for (const [p, m] of rootVars) root.push(`  ${p}: ${m} !important;`);
    root.push('}');

    const dark = ['.sk-client-theme--dark {'];
    for (const [p, m] of darkVars) dark.push(`  ${p}: ${m} !important;`);
    dark.push('}');

    const skOv = skRules.map((r) => `${r.sel} { ${r.prop}: ${r.mapped} !important; }`).join('\n');
    const lit = literalRules.map((r) => `${r.sel} { ${r.prop}: ${r.mapped} !important; }`).join('\n');
    const shadows = shadowRules.map((r) => `${r.sel} { box-shadow: ${r.mapped} !important; }`).join('\n');

    const core = `html, body, .p-ia4_body { background-color: var(--rk-background) !important; color: var(--rk-foreground) !important; color-scheme: dark; }
a { color: var(--rk-accent) !important; }
.ReactModal__Overlay:not(.c-popover):not(.c-menu) { background-color: color-mix(in oklch, var(--rk-crust) 65%, transparent) !important; }
.ReactModal__Overlay.c-popover, .ReactModal__Overlay.c-menu { background-color: transparent !important; }
.c-popover__content, .ReactModal__Content { background-color: transparent !important; box-shadow: none !important; border: none !important; }
.c-menu__list, .c-menu__items, [role="listbox"][class], [role="tooltip"][class] {
  background-color: var(--rk-surface0) !important;
  color: var(--rk-foreground) !important;
  box-shadow:
    0 8px 24px color-mix(in oklch, var(--rk-crust) 55%, transparent),
    0 0 0 1px color-mix(in oklch, var(--rk-foreground) 10%, transparent) !important;
}
.p-theme_background { background-color: var(--rk-background) !important; }
.c-alert.c-alert--level_info { background-color: color-mix(in oklch, var(--rk-magenta) 20%, var(--rk-mantle)) !important; }
.c-alert.c-alert--level_info [class*="colorPalettesAubergine"] { color: var(--rk-foreground) !important; }
[class*="sidebarBannerUnreads"] { background-color: var(--rk-red) !important; color: var(--rk-crust) !important; }
.c-menu_item__li--highlighted .p-more_menu_icon,
.c-menu_item__li--highlighted .p-more_menu_icon svg,
.c-menu_item__li--highlighted .p-more_menu_icon svg path { color: var(--rk-crust) !important; fill: var(--rk-crust) !important; }
:root, .sk-client-theme--dark {
  --p-team_sidebar__nav-bg: var(--rk-mantle) !important;
  --p-team_sidebar__badge: var(--rk-accent) !important;
  --p-team_sidebar__badge-text-color: var(--rk-crust) !important;
  --p-team_sidebar__text-color: var(--rk-foreground) !important;
  --p-team_sidebar__text-color--opacity-30: color-mix(in oklch, var(--rk-foreground) 30%, transparent) !important;
  --p-team_sidebar__text-color--opacity-10: color-mix(in oklch, var(--rk-foreground) 10%, transparent) !important;
  --p-team_sidebar__text-color--mix-80: color-mix(in oklch, var(--rk-foreground) 80%, var(--rk-background)) !important;
  --p-team_sidebar__text-color--mix-10: color-mix(in oklch, var(--rk-foreground) 10%, var(--rk-background)) !important;
  --p-team_sidebar__color-focus-ring: 0 0 0 3px var(--rk-background), 0 0 0 4px var(--rk-foreground), 0 0 0 6px color-mix(in oklch, var(--rk-foreground) 30%, transparent) !important;
  --border-color: var(--rk-border) !important;
  --spacer-color: var(--rk-muted) !important;
  --rc-drag-handle-bg-colour: color-mix(in oklch, var(--rk-foreground) 20%, transparent) !important;
}
.sk-client-theme--dark .c-reaction--reacted { color: var(--rk-crust) !important; }`;

    const css = [root.join('\n'), dark.join('\n'), skOv, lit, shadows, core].join('\n');
    return {
      css,
      stats: {
        sk: skRules.length,
        root: rootVars.size,
        dark: darkVars.size,
        lit: literalRules.length,
        shadow: shadowRules.length,
        bytes: css.length,
        ms: Math.round(performance.now() - t0),
      },
    };
  };

  // ─── 7. style tag singleton + runner ──────────────────────────────────────
  let styleEl = null;
  const ensureStyle = () => {
    if (styleEl && styleEl.isConnected) return styleEl;
    styleEl = document.createElement('style');
    styleEl.id = 'ricekit-slack';
    (document.head || document.documentElement).appendChild(styleEl);
    return styleEl;
  };

  const runHarvest = () => {
    const palette = readPalette();
    if (!isPaletteReady(palette)) return false;
    try {
      const { css, stats } = harvest();
      ensureStyle().textContent = css;
      dbg.harvestCount++;
      dbg.lastHarvestMs = stats.ms;
      dbg.lastStats = stats;
      dbg.lastPaletteHash = paletteHash(palette);
      dbg.state = 'ready';
      return true;
    } catch (e) {
      dbg.errors.push({ phase: 'run', msg: String(e) });
      dbg.state = 'error';
      console.warn('[ricekit-slack] harvest failed', e);
      return false;
    }
  };

  // Coalesce bursts of stylesheet additions into one re-harvest.
  let pending = false;
  const scheduleHarvest = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; runHarvest(); }, 200);
  };

  // ─── 8. start ─────────────────────────────────────────────────────────────
  const start = () => {
    runHarvest();
    // Style-node observer: catches <style>/<link rel="stylesheet"> inserted
    // anywhere in the tree — head chunks, body portals (emoji picker, menus,
    // huddle), deeply nested React-rendered wrappers. The 200ms scheduleHarvest
    // debounce absorbs bursty inserts so subtree:true stays cheap.
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeName === 'STYLE' && n.id !== 'ricekit-slack') return scheduleHarvest();
          if (n.nodeName === 'LINK' && n.rel === 'stylesheet') return scheduleHarvest();
          if (n.nodeType === 1 && n.querySelector
              && n.querySelector('style:not(#ricekit-slack), link[rel="stylesheet"]')) {
            return scheduleHarvest();
          }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    // Sheet-signature poll: catches mutations a MutationObserver can't see.
    // adoptedStyleSheets pushes are property writes (no DOM event); insertRule
    // calls from emotion/styled-components mutate the CSSOM in place; an async
    // <link> fires the insert mutation before its cssRules populate. A length
    // diff across document.styleSheets + adoptedStyleSheets + per-sheet rule
    // counts triggers a re-harvest on any of these.
    const sheetSig = () => {
      const parts = [];
      try { parts.push(`s${document.styleSheets.length}`); } catch {}
      try { parts.push(`a${(document.adoptedStyleSheets || []).length}`); } catch {}
      for (const s of document.styleSheets) {
        try { parts.push(s.cssRules ? s.cssRules.length : -1); }
        catch { parts.push(-2); }
      }
      return parts.join('|');
    };
    let lastSheetSig = sheetSig();
    setInterval(() => {
      const sig = sheetSig();
      if (sig === lastSheetSig) return;
      lastSheetSig = sig;
      scheduleHarvest();
    }, 1500);
    // Palette poll: re-harvest when --rk-* on :root changes (Stylus theme
    // switch, or ricekit-vars.css hot-reload from the desktop integration).
    let lastHash = paletteHash(readPalette());
    setInterval(() => {
      const palette = readPalette();
      if (!isPaletteReady(palette)) return;
      const h = paletteHash(palette);
      if (h === lastHash) return;
      lastHash = h;
      runHarvest();
    }, 1000);
    // Retry every second until palette is ready (initial paint may beat the
    // userstyle / ricekit-vars.css insertion).
    if (dbg.state !== 'ready') {
      const retry = setInterval(() => {
        if (runHarvest()) clearInterval(retry);
      }, 500);
      setTimeout(() => clearInterval(retry), 30_000);
    }
  };

  if (document.head) start();
  else {
    const wait = new MutationObserver(() => {
      if (document.head) { wait.disconnect(); start(); }
    });
    wait.observe(document.documentElement, { childList: true });
  }
})();
