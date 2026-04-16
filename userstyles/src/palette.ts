// Ricekit palette — the 22 ANSI + semantic tokens we expose at :root as
// --rk-*. The Catppuccin-named slots (mauve, peach, surface0, overlays,
// etc.) are derived in CSS at runtime via OKLCH relative-color expressions
// — no JS-side color math happens here.

export type RicekitPalette = {
  foreground: string;
  background: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  bright_black: string;
  bright_red: string;
  bright_green: string;
  bright_yellow: string;
  bright_blue: string;
  bright_magenta: string;
  bright_cyan: string;
  bright_white: string;
  accent: string;
  surface: string;
  border: string;
  muted: string;
};

// Parse the output of `ricekit theme show <name>` into a RicekitPalette.
export function parseRicekitThemeShow(output: string): RicekitPalette {
  const pairs: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const m = line.trim().match(/^([a-z_]+)\s+(#[0-9a-fA-F]{6})$/);
    if (m) pairs[m[1]] = m[2].toLowerCase();
  }
  const required: (keyof RicekitPalette)[] = [
    "foreground", "background", "black", "red", "green", "yellow", "blue",
    "magenta", "cyan", "white", "bright_black", "bright_red", "bright_green",
    "bright_yellow", "bright_blue", "bright_magenta", "bright_cyan",
    "bright_white", "accent", "surface", "border", "muted",
  ];
  for (const k of required) {
    if (!pairs[k]) throw new Error(`missing color in ricekit output: ${k}`);
  }
  return pairs as RicekitPalette;
}

// Build the :root CSS block that ricekit-userstyles installs at runtime.
//
// Tier 1 — the 22 ricekit ANSI + semantic tokens, 1:1 with `ricekit theme
// show`. Source of truth.
//
// Tier 2 — Catppuccin-named slots that the style guide's ANSI mapping doesn't
// cover (surface0, bg tiers, overlays, the non-ANSI accent variants). Each
// is an OKLCH relative-color expression against a tier-1 var, so the result
// tracks whatever ricekit theme is active — change the ricekit theme, every
// tier-2 var updates at CSS runtime.
//
// OKLCH offsets are calibrated against Catppuccin Mocha (the canonical dark
// reference) so rendering stays close to Catppuccin's visual design when
// ricekit's base colors match typical dark-theme conventions.
export function generateRootCss(p: RicekitPalette, header?: string): string {
  return `${header ? header + "\n" : ""}:root {
  --rk-foreground: ${p.foreground};
  --rk-background: ${p.background};
  --rk-accent: ${p.accent};
  --rk-surface: ${p.surface};
  --rk-border: ${p.border};
  --rk-muted: ${p.muted};
  --rk-black: ${p.black};
  --rk-red: ${p.red};
  --rk-green: ${p.green};
  --rk-yellow: ${p.yellow};
  --rk-blue: ${p.blue};
  --rk-magenta: ${p.magenta};
  --rk-cyan: ${p.cyan};
  --rk-white: ${p.white};
  --rk-bright-black: ${p.bright_black};
  --rk-bright-red: ${p.bright_red};
  --rk-bright-green: ${p.bright_green};
  --rk-bright-yellow: ${p.bright_yellow};
  --rk-bright-blue: ${p.bright_blue};
  --rk-bright-magenta: ${p.bright_magenta};
  --rk-bright-cyan: ${p.bright_cyan};
  --rk-bright-white: ${p.bright_white};

  --rk-surface0: oklch(from var(--rk-background) calc(l + 0.06) c h);
  --rk-mantle: oklch(from var(--rk-background) calc(l - 0.03) c h);
  --rk-crust: oklch(from var(--rk-background) calc(l - 0.06) c h);

  --rk-overlay0: oklch(from var(--rk-muted) calc(l - 0.07) c h);
  --rk-overlay1: var(--rk-muted);
  --rk-overlay2: oklch(from var(--rk-muted) calc(l + 0.09) c h);

  --rk-maroon: oklch(from var(--rk-red) calc(l + 0.04) calc(c - 0.07) h);
  --rk-flamingo: oklch(from var(--rk-red) calc(l + 0.13) calc(c - 0.1) h);
  --rk-rosewater: oklch(from var(--rk-red) calc(l + 0.17) calc(c - 0.11) calc(h + 16));
  --rk-peach: oklch(from var(--rk-red) calc(l + 0.08) calc(c - 0.02) calc(h + 40));
  --rk-sapphire: oklch(from var(--rk-blue) calc(l + 0.04) c calc(h - 13));
  --rk-sky: oklch(from var(--rk-cyan) l c calc(h + 37));
  --rk-lavender: oklch(from var(--rk-blue) calc(l + 0.04) c calc(h + 27));
}`;
}
