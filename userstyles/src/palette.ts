// Ricekit → Catppuccin 26-token palette mapping.
//
// Reads a ricekit theme show dump and produces the 26 hex values Catppuccin
// userstyles expect. Direct ANSI mappings follow the Catppuccin style guide
// (docs/style-guide.md): ANSI → Catppuccin token is fixed per-flavor. Tokens
// with no ANSI counterpart (rosewater, flamingo, mauve, maroon, peach,
// sapphire, sky, lavender, base/mantle/crust, overlay tiers, surface0/2,
// subtext1, text) are derived via sRGB blends from ricekit's semantic palette.

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

export type CatppuccinPalette = {
  rosewater: string;
  flamingo: string;
  pink: string;
  mauve: string;
  red: string;
  maroon: string;
  peach: string;
  yellow: string;
  green: string;
  teal: string;
  sky: string;
  sapphire: string;
  blue: string;
  lavender: string;
  text: string;
  subtext1: string;
  subtext0: string;
  overlay2: string;
  overlay1: string;
  overlay0: string;
  surface2: string;
  surface1: string;
  surface0: string;
  base: string;
  mantle: string;
  crust: string;
};

export const CATPPUCCIN_TOKENS: (keyof CatppuccinPalette)[] = [
  "rosewater",
  "flamingo",
  "pink",
  "mauve",
  "red",
  "maroon",
  "peach",
  "yellow",
  "green",
  "teal",
  "sky",
  "sapphire",
  "blue",
  "lavender",
  "text",
  "subtext1",
  "subtext0",
  "overlay2",
  "overlay1",
  "overlay0",
  "surface2",
  "surface1",
  "surface0",
  "base",
  "mantle",
  "crust",
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// Linear sRGB blend. weight=0 returns a, weight=1 returns b.
function blend(a: string, b: string, weight: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(
    ar + (br - ar) * weight,
    ag + (bg - ag) * weight,
    ab + (bb - ab) * weight,
  );
}

// Shift sRGB lightness by adding/subtracting from each channel proportionally.
// Positive lightens toward white, negative darkens toward black.
function shift(hex: string, delta: number): string {
  return delta >= 0 ? blend(hex, "#ffffff", delta) : blend(hex, "#000000", -delta);
}

export function mapRicekitToCatppuccin(r: RicekitPalette): CatppuccinPalette {
  // Direct ANSI → Catppuccin mappings from the style guide:
  //   red, green, yellow, blue are 1:1
  //   magenta → pink, cyan → teal
  //   white → subtext0, bright_white → subtext1
  const pink = r.magenta;
  const teal = r.cyan;
  const red = r.red;
  const green = r.green;
  const yellow = r.yellow;
  const blue = r.blue;
  const text = r.foreground;
  const base = r.background;
  const crust = r.surface;
  const mantle = blend(base, crust, 0.5);

  // Text tiers: step from `text` toward `muted`. Catppuccin's subtext1/0 are
  // slightly muted text, not brighter — so using bright_white (lighter than fg)
  // would invert the semantics.
  const subtext1 = blend(text, r.muted, 0.25);
  const subtext0 = blend(text, r.muted, 0.55);

  // Surface/overlay tiers: interpolate `base` → `muted` → `text`. This keeps
  // ricekit's tint (rather than drifting to pure grey) and flips correctly on
  // light themes since muted and text sit on the opposite side of base.
  const surface0 = blend(base, r.muted, 0.15);
  const surface1 = blend(base, r.muted, 0.30);
  const surface2 = blend(base, r.muted, 0.50);
  const overlay0 = r.muted;
  const overlay1 = blend(r.muted, subtext0, 0.45);
  const overlay2 = blend(r.muted, subtext0, 0.80);

  // Accent derivations:
  //   maroon   = deeper red toward magenta
  //   peach    = orange (red + yellow midpoint)
  //   flamingo = red lightened toward white
  //   rosewater = red lightened more, almost pastel
  //   mauve    = magenta shifted toward blue — distinctly purple
  //   sapphire = midpoint of cyan and blue
  //   sky      = cyan lightened
  //   lavender = blue shifted toward magenta, lightened
  const maroon = blend(red, pink, 0.35);
  const peach = blend(red, yellow, 0.5);
  const flamingo = shift(red, 0.18);
  const rosewater = shift(red, 0.35);
  const mauve = blend(pink, blue, 0.3);
  const sapphire = blend(teal, blue, 0.5);
  const sky = shift(teal, 0.22);
  const lavender = shift(blend(blue, pink, 0.25), 0.08);

  return {
    rosewater,
    flamingo,
    pink,
    mauve,
    red,
    maroon,
    peach,
    yellow,
    green,
    teal,
    sky,
    sapphire,
    blue,
    lavender,
    text,
    subtext1,
    subtext0,
    overlay2,
    overlay1,
    overlay0,
    surface2,
    surface1,
    surface0,
    base,
    mantle,
    crust,
  };
}

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
