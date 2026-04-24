// Linear theme harvester
// Paste this into Chrome DevTools console on https://linear.app/
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

  const core = `
html, html.dark, html.light, html[data-theme], body {
  background-color: var(--rk-background) !important; color: var(--rk-foreground) !important; color-scheme: dark;
}
html, html.dark, html.light, html[data-theme] {
  --bg-base-color: var(--rk-background) !important;
  --bg-sidebar-color: var(--rk-mantle) !important;
  --bg-border-color: var(--rk-border) !important;
  --bg-color: var(--rk-background) !important;
  --bg-base-color-dark: var(--rk-background) !important;
  --bg-sidebar-dark: var(--rk-mantle) !important;
  --bg-border-color-dark: var(--rk-border) !important;
  --content-color-dark: var(--rk-muted) !important;
  --content-highlight-color-dark: var(--rk-foreground) !important;
}
main[class] { background-color: var(--rk-background) !important; color: var(--rk-foreground) !important; }
nav[class] { background-color: var(--rk-mantle) !important; color: var(--rk-foreground) !important; }
[role="dialog"][class], [role="menu"][class], [role="listbox"][class], [role="tooltip"][class] {
  background-color: var(--rk-surface0) !important; color: var(--rk-foreground) !important; border: 1px solid var(--rk-border) !important;
}
[role="menuitem"][class]:hover, [role="option"][class]:hover, [role="menuitem"][aria-selected="true"], [role="option"][aria-selected="true"] {
  background-color: color-mix(in oklch, var(--rk-accent) 25%, transparent) !important; color: var(--rk-foreground) !important;
}
nav[class] a[style*="background"], nav[class] button[style*="background"] {
  --sidebar-link-background: color-mix(in oklch, var(--rk-accent) 18%, transparent) !important;
  background-color: color-mix(in oklch, var(--rk-accent) 18%, transparent) !important;
  color: var(--rk-foreground) !important;
}
:root {
  --color-bg-primary: var(--rk-background) !important; --color-bg-secondary: var(--rk-surface0) !important;
  --color-bg-tertiary: var(--rk-surface1) !important; --color-bg-quaternary: var(--rk-mantle) !important;
  --color-text-primary: var(--rk-foreground) !important; --color-text-secondary: var(--rk-foreground) !important;
  --color-text-tertiary: var(--rk-muted) !important;
  --color-border-primary: var(--rk-border) !important; --color-border-secondary: var(--rk-border) !important;
}
a[href^="http"]:not([href*="linear.app"]) { color: var(--rk-accent) !important; }
input[class], textarea[class], [contenteditable="true"], .ProseMirror.editor:not(.readonly) {
  background-color: var(--rk-surface0) !important; color: var(--rk-foreground) !important; border-color: var(--rk-border) !important;
}`;

  // Map an lch() literal to a ricekit palette var based on L + hue buckets.
  const toVar = (lch) => {
    const m = lch.match(/lch\(\s*(-?\d+(?:\.\d+)?)%?\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const L = parseFloat(m[1]), C = parseFloat(m[2]), H = parseFloat(m[3]);
    if (C > 20) {
      if (H > 250 && H < 320) return `var(--rk-accent)`;
      if (H > 120 && H < 160) return `var(--rk-green)`;
      if (H > 60 && H < 100) return `var(--rk-yellow)`;
      if (H < 30 || H > 340) return `var(--rk-red)`;
    }
    if (L < 3) return `var(--rk-crust)`;
    if (L < 5.5) return `var(--rk-background)`;
    if (L < 8) return `var(--rk-mantle)`;
    if (L < 11) return `var(--rk-surface0)`;
    if (L < 16) return `var(--rk-surface1)`;
    if (L < 26) return `var(--rk-border)`;
    if (L < 45) return `var(--rk-muted)`;
    if (L < 75) return `var(--rk-overlay2)`;
    return `var(--rk-foreground)`;
  };

  // Walk both document.styleSheets AND document.adoptedStyleSheets (the latter holds the
  // `.theme-provider-*` --sx-* master color table that drives most of Linear's palette).
  const allSheets = [...document.styleSheets, ...(document.adoptedStyleSheets || [])];
  const hits = [];
  for (const sheet of allSheets) {
    try {
      for (const rule of sheet.cssRules || []) {
        if (!rule.style || !rule.selectorText) continue;
        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style[i];
          const val = rule.style.getPropertyValue(prop);
          if (val && /lch\(/.test(val)) hits.push({ sel: rule.selectorText, prop, val: val.trim() });
        }
      }
    } catch {}
  }

  const overrides = [];
  for (const { sel, prop, val } of hits) {
    const replaced = val.replace(/lch\([^)]+\)/g, (m) => {
      const v = toVar(m);
      const am = m.match(/\/\s*(-?\d+(?:\.\d+)?)\s*\)$/);
      if (am && parseFloat(am[1]) < 1) {
        const a = Math.round(parseFloat(am[1]) * 100);
        return `color-mix(in oklch, ${v} ${a}%, transparent)`;
      }
      return v || m;
    });
    overrides.push(`${sel} { ${prop}: ${replaced} !important; }`);
  }

  const css = palette + '\n' + core + '\n' + overrides.join('\n');

  try {
    await navigator.clipboard.writeText(css);
    console.log(`%c[ricekit-linear] ${overrides.length} rules, ${css.length} chars. Copied to clipboard.`, 'color:#89b4fa;font-weight:bold');
  } catch (e) {
    console.warn('[ricekit-linear] clipboard write failed. Output below:');
    console.log(css);
  }
})();
