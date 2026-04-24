// Slack theme harvester
// Paste this into Chrome DevTools console on https://app.slack.com/ (with dark theme enabled).
// Output (full ricekit.css) is copied to clipboard.
// See ./README.md for details.

(async () => {
  const palette = `:root {
  --rk-foreground: #cdd6f4; --rk-background: #1e1e2e; --rk-accent: #89b4fa;
  --rk-surface: #313244; --rk-border: #45475a; --rk-muted: #6c7086;
  --rk-red: #f38ba8; --rk-green: #a6e3a1; --rk-yellow: #f9e2af;
  --rk-mantle: oklch(from var(--rk-background) calc(l - 0.03) c h);
  --rk-crust: oklch(from var(--rk-background) calc(l - 0.06) c h);
  --rk-surface0: oklch(from var(--rk-background) calc(l + 0.06) c h);
  --rk-surface1: oklch(from var(--rk-background) calc(l + 0.09) c h);
  --rk-overlay0: oklch(from var(--rk-muted) calc(l - 0.07) c h);
  --rk-overlay1: var(--rk-muted);
  --rk-overlay2: oklch(from var(--rk-muted) calc(l + 0.09) c h);
}`;

  const core = `html, body, .p-ia4_body { background-color: var(--rk-background) !important; color: var(--rk-foreground) !important; color-scheme: dark; }
.ReactModal__Content, .c-popover__content { background-color: transparent !important; box-shadow: none !important; border: none !important; }
.c-menu__list, .c-menu__items, [role="listbox"][class], [role="tooltip"][class] {
  background-color: var(--rk-surface0) !important;
  color: var(--rk-foreground) !important;
  border: none !important;
  box-shadow: 0 8px 24px color-mix(in oklch, var(--rk-crust) 60%, transparent), 0 0 0 1px color-mix(in oklch, var(--rk-foreground) 10%, transparent) !important;
}
.ReactModal__Overlay.c-popover, .ReactModal__Overlay.c-menu { background-color: transparent !important; }
.ReactModal__Overlay:not(.c-popover):not(.c-menu) { background-color: color-mix(in oklch, var(--rk-crust) 70%, transparent) !important; }
a { color: var(--rk-accent) !important; }
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
}`;

  // Semantic mapping: var name → ricekit palette var.
  // Slack's naming is counterintuitive in spots — these values reflect what matches user expectations,
  // not Slack's raw hex values in either the light or dark defaults.
  // `--dt_color-theme-*` tokens drive the sidebar theme; when the sidebar mirrors the workspace
  // (our assumption for a dark ricekit theme), theme-base-* is dark and theme-content-inv-* is LIGHT
  // — the opposite of the non-theme content-inv-* family, which is dark (for dark-text-on-light-surface).
  const semantic = (name) => {
    if (name.startsWith('--dt_color-theme-')) return semanticTheme(name);
    return semanticCore(name);
  };
  const semanticTheme = (name) => {
    // theme-content-imp → text on a red surface; must contrast with red, not be red.
    // `--rk-crust` is the consistently-dark ricekit anchor that pairs with ricekit's bright reds.
    if (name === '--dt_color-theme-content-imp') return 'var(--rk-crust)';
    // theme-content-inv-* → light (sidebar text on dark sidebar). Flip from crust/mantle/border to fg family.
    if (name === '--dt_color-theme-content-inv-pry') return 'var(--rk-foreground)';
    if (name === '--dt_color-theme-content-inv-sec') return 'var(--rk-overlay2)';
    if (name === '--dt_color-theme-content-inv-ter') return 'var(--rk-muted)';
    // theme-base-inv-* → light surface (when sidebar is styled as inverted-light in dark mode).
    if (name === '--dt_color-theme-base-inv-pry') return 'var(--rk-foreground)';
    if (name === '--dt_color-theme-base-inv-sec') return 'var(--rk-overlay2)';
    // theme-surf-inv-* → hover/press overlays on dark sidebar: lift with foreground alpha.
    if (/^--dt_color-theme-surf-inv-(pry|sec|ter)$/.test(name)) {
      const step = name.endsWith('-pry') ? 6 : name.endsWith('-sec') ? 10 : 18;
      return `color-mix(in oklch, var(--rk-foreground) ${step}%, transparent)`;
    }
    // Everything else mirrors the non-theme mapping.
    return semanticCore(name.replace('--dt_color-theme-', '--dt_color-'));
  };
  const semanticCore = (name) => {
    // --dt_color-base-* = surfaces
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
    if (name === '--dt_color-base-modal') return 'color-mix(in oklch, var(--rk-crust) 70%, transparent)';
    if (/^--dt_color-base-(pry|sec|ter)-hover$/.test(name)) return 'color-mix(in oklch, var(--rk-foreground) 8%, transparent)';
    if (/^--dt_color-base-(pry|sec|ter)-pressed$/.test(name)) return 'color-mix(in oklch, var(--rk-foreground) 18%, transparent)';
    // --dt_color-content-* = text
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
    // --dt_color-surf-* = overlay surfaces
    if (name === '--dt_color-surf-pry') return 'color-mix(in oklch, var(--rk-foreground) 6%, transparent)';
    if (name === '--dt_color-surf-sec') return 'color-mix(in oklch, var(--rk-foreground) 10%, transparent)';
    if (name === '--dt_color-surf-imp') return 'color-mix(in oklch, var(--rk-red) 15%, transparent)';
    if (name === '--dt_color-surf-hgl-1') return 'color-mix(in oklch, var(--rk-accent) 15%, transparent)';
    if (name === '--dt_color-surf-hgl-2') return 'color-mix(in oklch, var(--rk-green) 15%, transparent)';
    if (name === '--dt_color-surf-hgl-3') return 'color-mix(in oklch, var(--rk-yellow) 15%, transparent)';
    if (/^--dt_color-surf-inv/.test(name)) return 'color-mix(in oklch, var(--rk-crust) 10%, transparent)';
    // --dt_color-otl-* = borders
    if (name === '--dt_color-otl-pry') return 'var(--rk-border)';
    if (name === '--dt_color-otl-sec') return 'color-mix(in oklch, var(--rk-border) 70%, transparent)';
    if (name === '--dt_color-otl-ter') return 'color-mix(in oklch, var(--rk-border) 50%, transparent)';
    if (name === '--dt_color-otl-imp') return 'var(--rk-red)';
    if (name === '--dt_color-otl-hgl-1') return 'var(--rk-accent)';
    if (name === '--dt_color-otl-hgl-2') return 'var(--rk-green)';
    if (name === '--dt_color-otl-hgl-3') return 'var(--rk-yellow)';
    if (/^--dt_color-otl-inv/.test(name)) return 'color-mix(in oklch, var(--rk-foreground) 20%, transparent)';
    // --dt_color-ctr-* = control
    if (name === '--dt_color-ctr-pry') return 'var(--rk-foreground)';
    if (name === '--dt_color-ctr-sec') return 'var(--rk-muted)';
    // brand-core
    if (name === '--dt_color-brand-core-slack-green') return 'var(--rk-green)';
    if (name === '--dt_color-brand-core-slack-red') return 'var(--rk-red)';
    if (name === '--dt_color-brand-core-black') return 'var(--rk-crust)';
    // brand-sec — secondary brand accents; map to closest ricekit family
    const brandSecMap = {
      berry:'--rk-red', bubblegum:'--rk-magenta', crimson:'--rk-red', salmon:'--rk-flamingo',
      mauve:'--rk-magenta', terracotta:'--rk-peach', peach:'--rk-peach', sandbar:'--rk-yellow',
      legal:'--rk-yellow', moss:'--rk-green', evergreen:'--rk-green', teal:'--rk-cyan',
      pool:'--rk-cyan', cobalt:'--rk-blue', 'bright-aubergine':'--rk-magenta',
      'small-text':'--rk-muted', text:'--rk-foreground',
      'bg-gray':'--rk-surface', 'inactive-gray':'--rk-muted',
    };
    const bsm = name.match(/^--dt_color-brand-sec-(.+)$/);
    if (bsm && brandSecMap[bsm[1]]) return `var(${brandSecMap[bsm[1]]})`;
    // constants
    if (name === '--dt_color-constants-white') return 'var(--rk-foreground)';
    if (name === '--dt_color-constants-black') return 'var(--rk-crust)';
    // Secondary outlines (soft variants) — use same hue but lower alpha
    const otlSec = name.match(/^--dt_color-otl-(hgl-[123]|imp)-sec$/);
    if (otlSec) {
      const base = otlSec[1].startsWith('hgl-') ? ({'hgl-1':'accent','hgl-2':'green','hgl-3':'yellow'})[otlSec[1]] : 'red';
      return `color-mix(in oklch, var(--rk-${base}) 50%, transparent)`;
    }
    // Hover/pressed derivatives — delegate to the base var at a slightly higher alpha blend.
    const hp = name.match(/^(--dt_color-[a-z-]+?(?:-[a-z0-9]+)?)-(hover|pressed)$/);
    if (hp) {
      const baseMapped = semanticCore(hp[1]);
      if (!baseMapped) return null;
      const bump = hp[2] === 'pressed' ? 14 : 8;
      // If baseMapped is a var() or color, mix with foreground for lift.
      return `color-mix(in oklch, ${baseMapped} ${100-bump}%, var(--rk-foreground) ${bump}%)`;
    }
    return null;
  };

  // Slack's own CSS uses `rgba(var(--sk_X), α)` internally. CSS can't convert hex → triplet,
  // so overriding --sk_X with a palette color doesn't plug in to Slack's rgba() call sites.
  // Instead, map each --sk_X to a --rk-* equivalent, and below we walk every Slack rule that
  // consumes var(--sk_X) and emit an override using rgb(from var(--rk-Y) r g b / α) — which
  // preserves Slack's α while sourcing the color from whatever palette is active.
  const skToRk = {
    '--sk_primary_background':      '--rk-background',
    '--sk_foreground_min_solid':    '--rk-mantle',
    '--sk_foreground_min':          '--rk-crust',
    '--sk_primary_foreground':      '--rk-foreground',
    '--sk_foreground_max':          '--rk-foreground',
    '--sk_foreground_max_solid':    '--rk-foreground',
    '--sk_foreground_high':         '--rk-foreground',
    '--sk_foreground_high_solid':   '--rk-overlay2',
    '--sk_foreground_mid':          '--rk-overlay2',
    '--sk_foreground_mid_solid':    '--rk-muted',
    '--sk_foreground_low':          '--rk-muted',
    '--sk_foreground_low_solid':    '--rk-border',
    '--sk_foreground_soft':         '--rk-foreground',
    '--sk_foreground_soft_solid':   '--rk-surface0',
    '--sk_highlight':               '--rk-accent',
    '--sk_highlight_hover':         '--rk-accent',
    '--sk_highlight_accent':        '--rk-accent',
    '--sk_inverted_foreground':     '--rk-crust',
    '--sk_inverted_background':     '--rk-foreground',
    '--sk_raspberry_red':           '--rk-red',
    '--sk_secondary_highlight':     '--rk-yellow',
    '--sk_secondary_foreground':    '--rk-muted',
  };

  // Slack also ships a `--dt_color-plt-*` triplet family (primary, gray, + 12 color scales
  // from 0 to 100). Elements like `.p-theme_background` reference these directly, so they
  // need the same rgb-from rewrite treatment as --sk_*.
  const SCALE_TO_RK = [
    { max:  7, rk: '--rk-crust' },
    { max: 17, rk: '--rk-mantle' },
    { max: 25, rk: '--rk-background' },
    { max: 45, rk: '--rk-surface' },
    { max: 55, rk: '--rk-border' },
    { max: 65, rk: '--rk-muted' },
    { max: 85, rk: '--rk-overlay2' },
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
  const pltToRk = (name) => {
    const m = name.match(/^--dt_color-plt-([a-z_]+)-(\d+)$/);
    if (!m) return null;
    const family = m[1];
    const scale = parseInt(m[2], 10);
    if (family in FAMILY_TO_RK) {
      const explicit = FAMILY_TO_RK[family];
      if (explicit) return explicit;
    }
    // primary/gray (or unknown family): use scale-tiered bg→fg spine
    for (const row of SCALE_TO_RK) if (scale <= row.max) return row.rk;
    return '--rk-foreground';
  };

  // Resolve any tokenized color var (--sk_*, --dt_color-plt-*) to its ricekit equivalent.
  const tokenToRk = (name) => {
    if (name.startsWith('--sk_')) return skToRk[name] || null;
    if (name.startsWith('--dt_color-plt-')) return pltToRk(name);
    return null;
  };

  // Rewrite a CSS value containing tokenized var() references into palette-driven equivalents.
  // - rgba(var(--TOKEN), α) → rgb(from var(--rk-Y) r g b / α)
  // - rgb(var(--TOKEN)) / rgba(var(--TOKEN)) → var(--rk-Y)
  // - bare var(--TOKEN [, fallback]) → var(--rk-Y)
  const TOKEN_RE = /(--sk_[a-zA-Z0-9_-]+|--dt_color-plt-[a-zA-Z0-9_-]+)/;
  const rewriteSkValue = (val) => {
    if (!TOKEN_RE.test(val)) return null;
    let out = val, changed = false;
    out = out.replace(
      /rgba?\(\s*var\(\s*(--sk_[a-zA-Z0-9_-]+|--dt_color-plt-[a-zA-Z0-9_-]+)(?:\s*,[^()]*)?\)\s*,\s*([^)]+)\)/g,
      (_, tok, alpha) => { const rk = tokenToRk(tok); if (!rk) return _; changed = true; return `rgb(from var(${rk}) r g b / ${alpha.trim()})`; },
    );
    out = out.replace(
      /rgba?\(\s*var\(\s*(--sk_[a-zA-Z0-9_-]+|--dt_color-plt-[a-zA-Z0-9_-]+)(?:\s*,[^()]*)?\)\s*\)/g,
      (_, tok) => { const rk = tokenToRk(tok); if (!rk) return _; changed = true; return `var(${rk})`; },
    );
    out = out.replace(
      /var\(\s*(--sk_[a-zA-Z0-9_-]+|--dt_color-plt-[a-zA-Z0-9_-]+)(?:\s*,[^)]+)?\)/g,
      (_, tok) => { const rk = tokenToRk(tok); if (!rk) return _; changed = true; return `var(${rk})`; },
    );
    return changed ? out : null;
  };

  const hexToRgb = (hex) => { let h = hex.replace('#',''); if (h.length === 3) h = h.split('').map(c=>c+c).join(''); if (h.length === 6) h += 'ff'; if (h.length !== 8) return null; return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), parseInt(h.slice(6,8),16)]; };
  const lum = (rgb) => { const [r,g,b] = rgb.map(c => { const x = c/255; return x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4); }); return 0.2126*r + 0.7152*g + 0.0722*b; };
  const rgbOf = (val) => {
    let m = val.match(/#[0-9a-fA-F]{3,8}\b/); if (m) return hexToRgb(m[0]);
    m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d*\.?\d+))?\s*\)/);
    if (m) return [parseInt(m[1]),parseInt(m[2]),parseInt(m[3]), m[4] ? Math.round(parseFloat(m[4])*255) : 255];
    return null;
  };
  // Fallback for literal hex/rgb rules: lightness-band mapping with invert (Slack's non-var rules are
  // typically light-theme literals; we want them re-mapped for dark theme).
  const mapLiteral = (val) => {
    const rgb = rgbOf(val); if (!rgb) return null;
    const [r,g,b,a] = rgb;
    let L = lum([r,g,b]);
    const alpha = a/255;
    if (alpha === 1) L = 1 - L;
    const chroma = Math.max(r,g,b) - Math.min(r,g,b);
    let pv;
    if (chroma > 100) {
      if (r > 180 && g < 140 && b < 140) pv='var(--rk-red)';
      else if (g > 180 && r < 160) pv='var(--rk-green)';
      else if (r > 180 && g > 160 && b < 140) pv='var(--rk-yellow)';
      else if (b > 180 && r < 180) pv='var(--rk-accent)';
      else pv='var(--rk-accent)';
    } else {
      if (L < 0.02) pv='var(--rk-crust)';
      else if (L < 0.06) pv='var(--rk-background)';
      else if (L < 0.1) pv='var(--rk-mantle)';
      else if (L < 0.18) pv='var(--rk-surface0)';
      else if (L < 0.28) pv='var(--rk-surface1)';
      else if (L < 0.42) pv='var(--rk-border)';
      else if (L < 0.6) pv='var(--rk-muted)';
      else if (L < 0.8) pv='var(--rk-overlay2)';
      else pv='var(--rk-foreground)';
    }
    if (alpha < 1) return `color-mix(in oklch, ${pv} ${Math.round(alpha*100)}%, transparent)`;
    return pv;
  };
  const mapValue = (val) => val.replace(/(#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*\d*\.?\d+)?\s*\))/g, m => mapLiteral(m) || m);

  // Skip list for decorative content (emoji, filetype icons, brand, animations) — we keep those original.
  const SKIP = ['skin_tone','skin-tone','filetype','file-type','c-icon--file','c-icon__file','c-icon--figma','c-icon--photoshop','c-icon--illustrator','c-icon--pdf','c-icon--sketch','c-icon--adobe','c-icon--indesign','emoji','p-emoji','brand-','brand_','animation','p-shouty','p-rooster','gif_picker','c-gif','preview','p-pillow_file','p-sales_dashboard','c-avatar_color','c-reaction','c-ladybug','p-celebration','p-party_hat','color-picker','p-slackbot','p-upgrades_icon','p-welcome','p-setup','p-confetti'];
  const shouldSkip = (sel) => SKIP.some(p => sel.includes(p));

  const rootVars = new Map(), darkVars = new Map();
  const literalRules = [], shadowRules = [], skRules = [];

  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules || []) {
        if (!rule.style || !rule.selectorText) continue;
        const sel = rule.selectorText.trim();

        // Semantic token harvest
        if (sel === ':root' || sel === '.sk-client-theme--dark') {
          const bucket = sel === ':root' ? rootVars : darkVars;
          for (let i = 0; i < rule.style.length; i++) {
            const p = rule.style[i];
            if (!p.startsWith('--dt_color-')) continue;
            const m = semantic(p);
            if (m) bucket.set(p, m);
          }
          continue; // do not emit literal/sk overrides for :root rules
        }

        if (shouldSkip(sel)) continue;

        // For every property whose value references --sk_*, emit a palette-driven override.
        // Also explicitly check common shorthand color-bearing properties — when authored as
        // `background: rgba(var(--sk_foo), 1)`, CSSStyleDeclaration enumerates it into empty
        // sub-properties (background-image/-color/etc.) but keeps the real value under the
        // shorthand key, so index-iteration alone misses them.
        const seen = new Set();
        for (let i = 0; i < rule.style.length; i++) {
          const p = rule.style[i];
          const v = rule.style.getPropertyValue(p);
          if (v) seen.add(`${p} ${v}`);
          if (!v || (!v.includes('--sk_') && !v.includes('--dt_color-plt-'))) continue;
          const nv = rewriteSkValue(v);
          if (nv) skRules.push({ sel: rule.selectorText, prop: p, mapped: nv });
        }
        for (const p of [
          'background','color','border','border-color','border-top','border-right','border-bottom','border-left',
          'border-top-color','border-right-color','border-bottom-color','border-left-color',
          'outline','outline-color','fill','stroke','caret-color','text-decoration-color',
        ]) {
          const v = rule.style.getPropertyValue(p);
          if (!v || !v.includes('--sk_') || seen.has(`${p} ${v}`)) continue;
          const nv = rewriteSkValue(v);
          if (nv) skRules.push({ sel: rule.selectorText, prop: p, mapped: nv });
        }

        // Literal color rules (bg/color/border/fill) — only those without any var() reference
        for (const prop of ['background-color','background','color','border-color','border','fill','stroke']) {
          const v = rule.style.getPropertyValue(prop);
          if (!v || /var\(/.test(v) || !/(#[0-9a-fA-F]{3,}|rgba?\()/.test(v)) continue;
          const nv = mapValue(v);
          if (nv !== v) literalRules.push({ sel: rule.selectorText, prop, mapped: nv });
        }

        // Box-shadow — rewrite token refs and/or literal hex segments.
        const sh = rule.style.getPropertyValue('box-shadow');
        if (sh) {
          let nv = sh;
          if (nv.includes('--sk_') || nv.includes('--dt_color-plt-')) nv = rewriteSkValue(nv) || nv;
          if (/(#[0-9a-fA-F]{3,}|rgba?\()/.test(nv)) nv = mapValue(nv);
          if (nv !== sh) shadowRules.push({ sel: rule.selectorText, mapped: nv });
        }
      }
    } catch {}
  }

  const root = [':root {'];
  for (const [p, m] of rootVars) root.push(`  ${p}: ${m} !important;`);
  root.push('}');

  const dark = ['.sk-client-theme--dark {'];
  for (const [p, m] of darkVars) dark.push(`  ${p}: ${m} !important;`);
  dark.push('}');

  const lit = literalRules.map(r => `${r.sel} { ${r.prop}: ${r.mapped} !important; }`).join('\n');
  const shadows = shadowRules.map(r => `${r.sel} { box-shadow: ${r.mapped} !important; }`).join('\n');
  const skOv = skRules.map(r => `${r.sel} { ${r.prop}: ${r.mapped} !important; }`).join('\n');

  const css = [palette, root.join('\n'), dark.join('\n'), core, skOv, lit, shadows].join('\n');

  try {
    await navigator.clipboard.writeText(css);
    console.log(`%c[ricekit-slack] sk=${skRefs.size} root=${rootVars.size} dark=${darkVars.size} literal=${literalRules.length} shadow=${shadowRules.length} (${css.length} chars). Copied to clipboard.`, 'color:#89b4fa;font-weight:bold');
  } catch (e) {
    console.warn('[ricekit-slack] clipboard write failed. Output below:');
    console.log(css);
  }
})();
