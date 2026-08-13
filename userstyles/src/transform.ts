import postcssLess from "npm:postcss-less@6.0.0";
import type { AtRule, Declaration, Root } from "npm:postcss@8.4";
import { PALETTE_MAP, rewriteDynamicValue } from "./rewrite-less.ts";

const RICEKIT_LIB_URL =
  "https://raw.githubusercontent.com/brs98/ricekit-community/main/userstyles/lib/std/v1.less";
const CATPPUCCIN_LIB_RE =
  /@import(\s+)(["'])https:\/\/userstyles\.catppuccin\.com\/lib\/(?:lib|std\/v1)\.less\2\s*;/g;
const UNKNOWN_VERSION_RE =
  /https:\/\/userstyles\.catppuccin\.com\/lib\/std\/(v(?!1\.less)[^/"']+\.less)/;
const PALETTE_META_RE =
  /^[ \t]*\*?[ \t]*@var[ \t]+(?:select|dropdown)[ \t]+(?:lightFlavor|darkFlavor|accentColor)[ \t]+[^\n]*(?:\n|$)/gm;
const STATIC_MOCHA: Record<string, string> = {
  rosewater: "#f5e0dc",
  flamingo: "#f2cdcd",
  pink: "#f5c2e7",
  accent: "#cba6f7",
  mauve: "#cba6f7",
  red: "#f38ba8",
  maroon: "#eba0ac",
  peach: "#fab387",
  yellow: "#f9e2af",
  green: "#a6e3a1",
  teal: "#94e2d5",
  sky: "#89dceb",
  sapphire: "#74c7ec",
  blue: "#89b4fa",
  lavender: "#b4befe",
  text: "#cdd6f4",
  subtext1: "#bac2de",
  subtext0: "#a6adc8",
  overlay2: "#9399b2",
  overlay1: "#7f849c",
  overlay0: "#6c7086",
  surface2: "#585b70",
  surface1: "#45475a",
  surface0: "#313244",
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",
};

export class UnsupportedUserStyleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedUserStyleError";
  }
}

type Edit = { start: number; end: number; replacement: string };

export function transformUserLess(source: string): string {
  const unknownVersion = source.match(UNKNOWN_VERSION_RE);
  if (unknownVersion) {
    throw unsupportedAt(
      source,
      unknownVersion.index ?? 0,
      `unsupported Catppuccin standard library std/${unknownVersion[1]}`,
    );
  }
  let importCount = 0;
  let transformed = source.replace(
    CATPPUCCIN_LIB_RE,
    (_whole, spacing: string, quote: string) => {
      importCount++;
      return `@import${spacing}${quote}${RICEKIT_LIB_URL}${quote};`;
    },
  );
  if (importCount !== 1) {
    throw new UnsupportedUserStyleError(
      `expected exactly one Catppuccin standard-library import, found ${importCount}`,
    );
  }

  transformed = transformed.replace(PALETTE_META_RE, "");
  transformed = applyStaticCompatibilityValues(transformed);
  transformed = rewriteDeclarationValues(transformed);
  transformed = applyStaticChannelValues(transformed);
  return applyLateCompatibilityValues(transformed);
}

function applyStaticCompatibilityValues(source: string): string {
  let out = source.replace(
    /multiply\(\s*@([\w-]+)\s*,\s*(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\s*\)/g,
    (whole, token: string, right: string) => {
      const left = STATIC_MOCHA[token];
      return left === undefined ? whole : multiplyHex(left, right);
    },
  );
  out = out.replace(
    /overlay\(\s*@([\w-]+)\s*,\s*@([\w-]+)\s*\)/g,
    (whole, leftToken: string, rightToken: string) => {
      const left = STATIC_MOCHA[leftToken];
      const right = STATIC_MOCHA[rightToken];
      return left === undefined || right === undefined
        ? whole
        : overlayHex(left, right);
    },
  );
  for (
    const [helper, colorIndex] of [["#hsl-variables", 1], [
      "#hslbreakdown",
      0,
    ]] as const
  ) {
    out = replaceBalancedFunction(out, helper, (body) => {
      const args = splitTopLevel(body);
      if (
        args.length !== 2 || args.every((arg) => arg.trim().startsWith("@"))
      ) {
        return null;
      }
      const token = args[colorIndex].match(/@([\w-]+)/)?.[1];
      const color = token === undefined ? undefined : STATIC_MOCHA[token];
      if (color === undefined) return null;
      args[colorIndex] = ` ${color}`;
      return `${helper}(${args.join(",")})`;
    });
  }
  return out;
}

function applyStaticChannelValues(source: string): string {
  return source.replace(
    /\b(hue|saturation|lightness)\(\s*@([\w-]+)\s*\)/g,
    (whole, channel: "hue" | "saturation" | "lightness", token: string) => {
      const color = STATIC_MOCHA[token];
      return color === undefined ? whole : hslChannel(color, channel);
    },
  );
}

function applyLateCompatibilityValues(source: string): string {
  let out = source.replace(
    /red\(\s*@([\w-]+)\s*\)\s+green\(\s*@\1\s*\)\s+blue\(\s*@\1\s*\)/g,
    (whole, token: string) => {
      const color = PALETTE_MAP[token];
      return color === undefined ? whole : `~"from ${color} r g b"`;
    },
  );
  out = out.replace(
    /\b(?:fade|lighten|darken|saturate|desaturate|spin|shade)\(\s*@[\w-]+\s*,\s*[^(),]+\)/g,
    (whole) => rewriteDynamicValue(whole),
  );
  return out;
}

function hslChannel(
  color: string,
  channel: "hue" | "saturation" | "lightness",
): string {
  const [red, green, blue] = [1, 3, 5].map((offset) =>
    Number.parseInt(color.slice(offset, offset + 2), 16) / 255
  );
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0
    ? 0
    : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const value = channel === "hue"
    ? hue
    : (channel === "saturation" ? saturation : lightness) * 100;
  const formatted = Number(value.toFixed(6)).toString();
  return channel === "hue" ? formatted : `${formatted}%`;
}

function multiplyHex(left: string, right: string): string {
  if (right.length === 4) {
    right = `#${right[1]}${right[1]}${right[2]}${right[2]}${right[3]}${
      right[3]
    }`;
  }
  const channels = [1, 3, 5].map((offset) => {
    const a = Number.parseInt(left.slice(offset, offset + 2), 16);
    const b = Number.parseInt(right.slice(offset, offset + 2), 16);
    return Math.round(a * b / 255).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function overlayHex(left: string, right: string): string {
  const channels = [1, 3, 5].map((offset) => {
    const a = Number.parseInt(left.slice(offset, offset + 2), 16) / 255;
    const b = Number.parseInt(right.slice(offset, offset + 2), 16) / 255;
    const value = a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
    return Math.round(value * 255).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function rewriteDeclarationValues(source: string): string {
  let root: Root;
  try {
    root = postcssLess.parse(source);
  } catch (error) {
    throw new UnsupportedUserStyleError(
      `could not parse LESS for localized transformation: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const aliases = collectPaletteAliases(root);
  const edits: Edit[] = [];
  root.walkAtRules((rule: AtRule) => {
    if (
      rule.nodes !== undefined || rule.params.length === 0 ||
      rule.params.includes("{")
    ) return;
    const start = rule.source?.start?.offset;
    if (start === undefined) return;
    const next = rewriteDeclarationValue(rule.params, aliases);
    if (next !== rule.params) {
      const identifierLength =
        (rule.raws as { identifier?: string }).identifier?.length ?? 1;
      const paramsStart = start + identifierLength + rule.name.length +
        (rule.raws.afterName ?? "").length;
      edits.push({
        start: paramsStart,
        end: paramsStart + rule.params.length,
        replacement: next,
      });
    }
  });
  root.walkDecls((decl: Declaration) => {
    const start = decl.source?.start?.offset;
    if (start === undefined) return;
    const valueStart = start + decl.prop.length +
      (decl.raws.between ?? ":").length;
    const next = rewriteDeclarationValue(decl.value, aliases);
    if (next !== decl.value) {
      edits.push({
        start: valueStart,
        end: valueStart + decl.value.length,
        replacement: next,
      });
    }
  });

  edits.sort((a, b) => b.start - a.start);
  let out = source;
  for (const edit of edits) {
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  }
  return out;
}

function collectPaletteAliases(root: Root): Record<string, string> {
  const declarations: { name: string; value: string }[] = [];
  root.walkAtRules((rule: AtRule) => {
    if (rule.nodes === undefined && isLessVariable(rule)) {
      declarations.push({ name: rule.name, value: rule.params.trim() });
    }
  });

  const valuesByName = new Map<string, Set<string>>();
  for (const { name, value } of declarations) {
    const values = valuesByName.get(name) ?? new Set<string>();
    values.add(value);
    valuesByName.set(name, values);
  }
  const unambiguous = declarations.filter(({ name }) =>
    valuesByName.get(name)?.size === 1
  );

  const aliases: Record<string, string> = {};
  for (let pass = 0; pass <= unambiguous.length; pass++) {
    let changed = false;
    for (const { name, value } of unambiguous) {
      const target = value.match(/^@([\w-]+)$/)?.[1];
      const direct = target === undefined
        ? undefined
        : PALETTE_MAP[target] ?? aliases[target];
      const rewritten = rewriteDynamicValue(value, aliases);
      const expression = rewritten.match(/^~"(.+)"$/)?.[1];
      const resolved = direct ?? expression;
      if (resolved !== undefined && aliases[name] !== resolved) {
        aliases[name] = resolved;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return aliases;
}

function isLessVariable(rule: AtRule): boolean {
  return (rule.raws.afterName ?? "").includes(":");
}

function rewriteDeclarationValue(
  value: string,
  aliases: Record<string, string>,
): string {
  let out = value.replace(
    /rgba?\(\s*#lib\.rgbify\(\s*@([\w-]+)\s*\)\s*\[\]\s*,\s*((?:var\([^)]*\)|[^)])+)\)/g,
    (whole, token: string, alpha: string) => {
      const color = paletteRef(token);
      if (color === null) return whole;
      return `~"rgb(from ${color} r g b / ${normalizeAlpha(alpha.trim())})"`;
    },
  );
  out = out.replace(
    /#lib\.rgbify\(\s*@([\w-]+)\s*\)\s*\[\]/g,
    (whole, token: string) =>
      token in PALETTE_MAP ? `~"var(--rk-${token}-rgb)"` : whole,
  );
  out = replaceHelperCalls(out, "#lib.rgbify", (expression) => {
    const token = expression.trim().match(/^@([\w-]+)$/)?.[1];
    if (token !== undefined && token in PALETTE_MAP) {
      return `~"var(--rk-${token}-rgb)"`;
    }
    const color = resolveColorExpression(expression, aliases);
    return color === null ? null : `~"from ${color} r g b"`;
  });
  out = replaceHelperCalls(out, "#lib.hslify", (expression) => {
    const color = resolveColorExpression(expression, aliases);
    return color === null ? null : `~"from ${color} h s l"`;
  });
  out = replaceHelperCalls(out, "#hslify", (expression) => {
    const color = resolveColorExpression(expression, aliases);
    return color === null ? null : `~"from ${color} h s l"`;
  });
  out = replaceHelperCalls(out, "#hsla", (expression) => {
    const color = resolveColorExpression(expression, aliases);
    return color === null ? null : `~"from ${color} h s l"`;
  });
  out = rewriteFlavorColorConditionals(out, aliases);
  out = rewriteChannelLists(out, aliases);
  out = rewriteDynamicValue(out, aliases);

  const unresolvedHelper = out.match(/#lib\.(?:rgbify|hslify)\b/);
  if (unresolvedHelper) {
    throw new UnsupportedUserStyleError(
      `unsupported standard-library helper expression: ${unresolvedHelper[0]}`,
    );
  }
  return out;
}

function replaceHelperCalls(
  value: string,
  helper: string,
  replacement: (expression: string) => string | null,
): string {
  let out = value;
  let searchFrom = 0;
  const marker = `${helper}(`;
  while (true) {
    const start = out.indexOf(marker, searchFrom);
    if (start === -1) return out;
    const close = matchingParen(out, start + helper.length);
    if (close === -1) return out;
    const expression = out.slice(start + marker.length, close);
    const next = replacement(expression);
    if (next === null) {
      searchFrom = close + 1;
      continue;
    }
    const suffixEnd = out.slice(close + 1).match(/^\s*\[\]/)?.[0].length ?? 0;
    out = out.slice(0, start) + next + out.slice(close + 1 + suffixEnd);
    searchFrom = start + next.length;
  }
}

function matchingParen(value: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = open; index < value.length; index++) {
    const char = value[index];
    if (quote !== null) {
      if (char === quote && value[index - 1] !== "\\") quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function resolveColorExpression(
  expression: string,
  aliases: Record<string, string>,
): string | null {
  const trimmed = expression.trim().replace(/,$/, "").trim();
  const token = trimmed.match(/^@([\w-]+)$/)?.[1];
  if (token !== undefined) {
    return PALETTE_MAP[token] ?? aliases[token] ?? `@{${token}}`;
  }
  const conditional = rewriteFlavorColorConditionals(trimmed, aliases);
  const rewritten = rewriteDynamicValue(conditional, aliases);
  if (rewritten === trimmed && conditional === trimmed) return null;
  return stripLessEscape(rewritten);
}

function stripLessEscape(value: string): string {
  return value.startsWith('~"') && value.endsWith('"')
    ? value.slice(2, -1)
    : value;
}

function rewriteFlavorColorConditionals(
  value: string,
  aliases: Record<string, string>,
): string {
  return replaceBalancedFunction(value, "if", (body) => {
    const args = splitTopLevel(body);
    const match = args.length === 3
      ? args[0].trim().match(
        /^@flavor\s*=\s*["']?(latte|frappe|macchiato|mocha)["']?$/,
      )
      : null;
    if (match === null) return null;
    const first = resolveSimpleColor(args[1], aliases);
    const second = resolveSimpleColor(args[2], aliases);
    if (first === null || second === null) return null;
    const lightDark = match[1] === "latte"
      ? `light-dark(${first}, ${second})`
      : `light-dark(${second}, ${first})`;
    return `~"${lightDark}"`;
  });
}

function resolveSimpleColor(
  value: string,
  aliases: Record<string, string>,
): string | null {
  const trimmed = value.trim();
  const token = trimmed.match(/^@([\w-]+)$/)?.[1];
  if (token !== undefined) {
    return PALETTE_MAP[token] ?? aliases[token] ?? `@{${token}}`;
  }
  const rewritten = rewriteDynamicValue(trimmed, aliases);
  return rewritten === trimmed ? null : stripLessEscape(rewritten);
}

function replaceBalancedFunction(
  value: string,
  name: string,
  replacement: (body: string) => string | null,
): string {
  let out = value;
  let searchFrom = 0;
  const marker = `${name}(`;
  while (true) {
    const start = out.indexOf(marker, searchFrom);
    if (start === -1) return out;
    const previous = start === 0 ? "" : out[start - 1];
    if (/[\w-]/.test(previous)) {
      searchFrom = start + marker.length;
      continue;
    }
    const close = matchingParen(out, start + name.length);
    if (close === -1) return out;
    const next = replacement(out.slice(start + marker.length, close));
    if (next === null) {
      searchFrom = close + 1;
      continue;
    }
    out = out.slice(0, start) + next + out.slice(close + 1);
    searchFrom = start + next.length;
  }
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote !== null) {
      if (char === quote && value[index - 1] !== "\\") quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
    } else if (char === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function rewriteChannelLists(
  value: string,
  aliases: Record<string, string>,
): string {
  const patterns = [
    /hsl\(\s*hue\((@[-\w]+)\)\s*,\s*saturation\(\1\)\s*,\s*([^)]+)\)/g,
    /hue\((@[-\w]+)\)\s+saturation\(\1\)\s+lightness\(\1\)/g,
  ];
  let out = value.replace(
    patterns[0],
    (whole, variable: string, lightness: string) => {
      const color = resolveSimpleColor(variable, aliases);
      return color === null
        ? whole
        : `~"hsl(from ${color} h s ${lightness.trim()})"`;
    },
  );
  out = out.replace(patterns[1], (whole, variable: string) => {
    const color = resolveSimpleColor(variable, aliases);
    return color === null ? whole : `~"from ${color} h s l"`;
  });
  out = out.replace(
    /red\((@[-\w]+)\)\s*,\s*green\(\1\)\s*,\s*blue\(\1\)/g,
    (whole, variable: string) => {
      const color = resolveSimpleColor(variable, aliases);
      return color === null ? whole : `~"from ${color} r g b"`;
    },
  );
  return out;
}

function paletteRef(token: string): string | null {
  return PALETTE_MAP[token] ?? null;
}

function normalizeAlpha(alpha: string): string {
  const percent = alpha.match(/^(-?\d+(?:\.\d+)?)%$/);
  return percent ? (Number(percent[1]) / 100).toString() : alpha;
}

function unsupportedAt(
  source: string,
  offset: number,
  reason: string,
): UnsupportedUserStyleError {
  const line = source.slice(0, offset).split("\n").length;
  return new UnsupportedUserStyleError(`line ${line}: ${reason}`);
}
