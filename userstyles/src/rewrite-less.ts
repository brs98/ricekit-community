// Rewrite LESS color-math calls on Catppuccin palette variables into escaped
// CSS relative-color expressions, so that the compiled output references
// `var(--ctp-*)` and is controllable at runtime by setting those variables.
//
// LESS operators we handle (others pass through untouched):
//   fade(c, p%)        → rgb(from c r g b / p/100)
//   lighten(c, p%)     → hsl(from c h s calc(l + p%))
//   darken(c, p%)      → hsl(from c h s calc(l - p%))
//   saturate(c, p%)    → hsl(from c h calc(s + p%) l)
//   desaturate(c, p%)  → hsl(from c h calc(s - p%) l)
//   spin(c, d)         → hsl(from c calc(h + d) s l)
//   shade(c, p%)       → color-mix(in srgb, black p%, c)
//   mix(a, b)          → color-mix(in srgb, a 50%, b)
//   mix(a, b, p%)      → color-mix(in srgb, a p%, b)
//
// The single LESS argument that matters is the color argument — if it resolves
// to a recognized Catppuccin palette variable, we substitute `var(--ctp-<name>)`.
// Nested calls like `lighten(fade(@base, 50%), 10%)` rewrite inside-out and
// compose as nested CSS relative-color expressions.

import valueParser, { type Node } from "npm:postcss-value-parser@4.2.0";

export const PALETTE_NAMES = new Set([
  "rosewater", "flamingo", "pink", "mauve", "red", "maroon",
  "peach", "yellow", "green", "teal", "sky", "sapphire",
  "blue", "lavender", "text", "subtext1", "subtext0",
  "overlay2", "overlay1", "overlay0", "surface2", "surface1",
  "surface0", "base", "mantle", "crust", "accent",
]);

function stripFilterSuffix(name: string): string {
  return name.endsWith("-filter") ? name.slice(0, -"-filter".length) : name;
}

function isPaletteVarToken(token: string): boolean {
  if (!token.startsWith("@")) return false;
  const name = stripFilterSuffix(token.slice(1));
  return PALETTE_NAMES.has(name);
}

function paletteVarCssRef(token: string): string {
  // Filter variants are not colors (they're SVG filter strings), so they pass
  // through unchanged — but callers only invoke this after isPaletteVarToken
  // returned true, so we just need the base name.
  const raw = token.slice(1);
  if (raw.endsWith("-filter")) {
    // Keep filter vars as-is; they're not colors we control via :root CSS vars.
    return token;
  }
  return `var(--ctp-${raw})`;
}

// Split a function's child nodes into argument groups (separated by commas).
function splitArgs(children: Node[]): Node[][] {
  const groups: Node[][] = [];
  let current: Node[] = [];
  for (const node of children) {
    if (node.type === "div" && node.value === ",") {
      groups.push(current);
      current = [];
    } else {
      current.push(node);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// Reconstruct an argument group as a raw string, trimmed of leading/trailing
// whitespace tokens. Does not rewrite anything — just serializes.
function stringifyArgRaw(nodes: Node[]): string {
  return valueParser.stringify(nodes as never).trim();
}

// Split a string by top-level commas, respecting parens and quoted strings.
function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      buf += c;
      if (c === inString && s[i - 1] !== "\\") inString = null;
    } else if (c === '"' || c === "'") {
      buf += c;
      inString = c;
    } else if (c === "(") {
      buf += c;
      depth++;
    } else if (c === ")") {
      buf += c;
      depth--;
    } else if (c === "," && depth === 0) {
      parts.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf.length > 0) parts.push(buf);
  return parts;
}

// compile.ts seeds lightFlavor = darkFlavor = "mocha" as LESS globals, so
// @flavor (the parameter passed to every `#catppuccin(@flavor)` mixin call)
// is always "mocha" in our pipeline. That lets us evaluate LESS conditionals
// like `if(@flavor = "latte", A, B)` at build time without running LESS.
const STATIC_FLAVOR = "mocha";

// Replace `if(@flavor = "X", A, B)` (and the unquoted `@flavor = X` variant)
// with A or B depending on whether X matches STATIC_FLAVOR. Recurses so that
// nested if() calls in either branch are also resolved. Anything that isn't
// a flavor-conditional `if()` passes through unchanged.
function resolveFlavorConditionals(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const idx = s.indexOf("if(", i);
    if (idx === -1) {
      out += s.slice(i);
      break;
    }
    // Bail if this is part of a larger identifier like `elif(` — only match
    // `if` as a standalone identifier.
    const prev = idx > 0 ? s[idx - 1] : "";
    if (/[A-Za-z0-9_$-]/.test(prev)) {
      out += s.slice(i, idx + 3);
      i = idx + 3;
      continue;
    }
    // Scan from after `if(` to the matching `)`, respecting nested parens
    // and string literals.
    let depth = 1;
    let j = idx + 3;
    let inString: string | null = null;
    for (; j < s.length && depth > 0; j++) {
      const c = s[j];
      if (inString) {
        if (c === inString && s[j - 1] !== "\\") inString = null;
      } else if (c === '"' || c === "'") {
        inString = c;
      } else if (c === "(") {
        depth++;
      } else if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) {
      out += s.slice(i);
      break;
    }
    const inner = s.slice(idx + 3, j);
    const args = splitTopLevelCommas(inner);
    const cond = args.length === 3 ? args[0].trim() : null;
    const m = cond?.match(/^@flavor\s*=\s*"?(\w+)"?$/);
    if (m) {
      const chosen = m[1] === STATIC_FLAVOR ? args[1].trim() : args[2].trim();
      out += s.slice(i, idx);
      out += resolveFlavorConditionals(chosen);
      i = j + 1;
    } else {
      // Not a flavor conditional — emit the if(...) call unchanged but
      // still recurse into its body in case a branch-arg is one.
      out += s.slice(i, idx + 3);
      out += resolveFlavorConditionals(inner);
      out += ")";
      i = j + 1;
    }
  }
  return out;
}

// Extract a numeric percent value (e.g. "30%" → 30) or a plain number from an
// argument group. Returns the canonical string form for CSS consumption.
function numericArg(nodes: Node[]): string {
  return stringifyArgRaw(nodes);
}

// Rewrite a value-parser node in place. If `inUnknown` is true we're inside
// a non-color LESS function like `#lib.rgbify(...)` or `#hslify(...)` that
// needs to see real LESS hex colors for its own evaluation — so we skip all
// palette-var substitution and color-op rewrites in that subtree. Otherwise
// palette vars become `var(--ctp-*)` and known ops become `~"<CSS expr>"`
// (the `~"..."` is LESS's escape-string syntax, which passes the inner text
// through to the compiled CSS without LESS trying to parse it).
function rewriteNode(node: Node, inUnknown: boolean): boolean {
  let changed = false;

  if (node.type === "function" && node.nodes) {
    const isKnown = KNOWN_OPS.has(node.value);
    const childInUnknown = inUnknown || !isKnown;
    for (const child of node.nodes) {
      if (rewriteNode(child, childInUnknown)) changed = true;
    }

    if (inUnknown || !isKnown) return changed;

    const args = splitArgs(node.nodes);
    const cssExpr = tryBuildOp(node.value, args);
    if (cssExpr === null) return changed;

    // Store raw CSS — no `~"..."` escape. The outermost rewrite adds the
    // escape once at the end to avoid nested-quote parse errors in LESS.
    (node as unknown as { type: string; value: string }).type = "word";
    (node as unknown as { type: string; value: string }).value = cssExpr;
    delete (node as unknown as { nodes?: Node[] }).nodes;
    return true;
  }

  if (node.type === "word" && isPaletteVarToken(node.value)) {
    if (!inUnknown) {
      node.value = paletteVarCssRef(node.value);
      return true;
    }
  }

  return changed;
}

// Build a CSS expression for a recognized LESS color-math call, or null if
// the argument shape isn't one we rewrite. The first arg group is the color
// expression (already rewritten by post-order walk); subsequent groups are
// scalar args like percent or degree.
function tryBuildOp(op: string, args: Node[][]): string | null {
  if (args.length === 0) return null;

  const color = stringifyArgRaw(args[0]);

  switch (op) {
    case "fade": {
      if (args.length !== 2) return null;
      const pct = numericArg(args[1]).replace(/%$/, "");
      const alpha = (parseFloat(pct) / 100).toString();
      return `rgb(from ${color} r g b / ${alpha})`;
    }
    case "lighten":
      return args.length === 2
        ? `hsl(from ${color} h s calc(l + ${numericArg(args[1])}))`
        : null;
    case "darken":
      return args.length === 2
        ? `hsl(from ${color} h s calc(l - ${numericArg(args[1])}))`
        : null;
    case "saturate":
      return args.length === 2
        ? `hsl(from ${color} h calc(s + ${numericArg(args[1])}) l)`
        : null;
    case "desaturate":
      return args.length === 2
        ? `hsl(from ${color} h calc(s - ${numericArg(args[1])}) l)`
        : null;
    case "spin": {
      if (args.length !== 2) return null;
      const deg = numericArg(args[1]);
      const degWithUnit = /[a-z]/i.test(deg) ? deg : `${deg}deg`;
      return `hsl(from ${color} calc(h + ${degWithUnit}) s l)`;
    }
    case "shade":
      return args.length === 2
        ? `color-mix(in srgb, black ${numericArg(args[1])}, ${color})`
        : null;
    case "mix": {
      // LESS mix(a, b) defaults weight to 50%; 3-arg form takes an explicit
      // percent. Either way we emit CSS color-mix() with the same semantics.
      if (args.length !== 2 && args.length !== 3) return null;
      const colorB = stringifyArgRaw(args[1]);
      const weight = args.length === 3 ? numericArg(args[2]) : "50%";
      return `color-mix(in srgb, ${color} ${weight}, ${colorB})`;
    }
    default:
      return null;
  }
}

const KNOWN_OPS = new Set([
  "fade", "lighten", "darken", "saturate", "desaturate",
  "spin", "shade", "mix",
]);

// After walking, any word node whose value contains CSS relative-color or
// color-mix syntax was produced by our rewriter and must be wrapped with
// LESS escape syntax (`~"..."`) so LESS passes it through untouched.
const NEEDS_ESCAPE_RE = /^(?:rgb|hsl|color-mix)\(/;
function wrapRewrittenWords(nodes: Node[]): void {
  for (const node of nodes) {
    if (node.type === "word" && NEEDS_ESCAPE_RE.test(node.value)) {
      node.value = `~"${node.value}"`;
    }
  }
}

/** Rewrite a declaration value string. Safe to call on any LESS declaration. */
export function rewriteValue(value: string): string {
  // Resolve LESS flavor conditionals first so nested if() calls inside a
  // known color op don't end up inside a `~"..."` escape (which LESS doesn't
  // evaluate) and don't collide with the escape's own double quotes.
  const resolved = resolveFlavorConditionals(value);
  const parsed = valueParser(resolved);
  let changed = resolved !== value;
  for (const node of parsed.nodes) {
    if (rewriteNode(node, false)) changed = true;
  }
  if (changed) wrapRewrittenWords(parsed.nodes);
  return changed ? parsed.toString() : value;
}
