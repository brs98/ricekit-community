// Compile a Catppuccin userstyle (.user.less) → .user.css with:
//   - Every palette-var use rewritten to var(--ctp-*)
//   - Every LESS color-math op on palette vars rewritten to CSS relative colors
//   - The remote @import swapped for an inlined stub of #lib.* mixins
//   - @lightFlavor/@darkFlavor/@accentColor defaulted so stray LESS expressions
//     (e.g. `when (@flavor = latte)`) still resolve to something

import less from "npm:less@4.2.1";
// deno-lint-ignore no-unused-vars
import postcss from "npm:postcss@8.4";
import postcssLess from "npm:postcss-less@6.0.0";
import { rewriteValue } from "./rewrite-less.ts";

// Static stub of the lib's mixins. Palette values are the Mocha defaults —
// anything that reaches these still-hex vars went through a non-rewritten
// path (e.g. `#lib.rgbify(@accent)`) and needs a real color. All filter
// variables are set to `none` since we don't attempt to runtime-theme the
// SVG-filter-based icon recolor pipeline (that would require per-color hue
// rotations recomputed from the live palette — not worth the complexity).
const PALETTE_TOKENS = [
  ["rosewater", "#f5e0dc"], ["flamingo", "#f2cdcd"], ["pink", "#f5c2e7"],
  ["mauve", "#cba6f7"], ["red", "#f38ba8"], ["maroon", "#eba0ac"],
  ["peach", "#fab387"], ["yellow", "#f9e2af"], ["green", "#a6e3a1"],
  ["teal", "#94e2d5"], ["sky", "#89dceb"], ["sapphire", "#74c7ec"],
  ["blue", "#89b4fa"], ["lavender", "#b4befe"], ["text", "#cdd6f4"],
  ["subtext1", "#bac2de"], ["subtext0", "#a6adc8"], ["overlay2", "#9399b2"],
  ["overlay1", "#7f849c"], ["overlay0", "#6c7086"], ["surface2", "#585b70"],
  ["surface1", "#45475a"], ["surface0", "#313244"], ["base", "#1e1e2e"],
  ["mantle", "#181825"], ["crust", "#11111b"], ["accent", "#cba6f7"],
];

// Read the real lib.less but strip out the `#lib` block — we replace it with
// our own that defers colors to var(--ctp-*) refs. The `@catppuccin` and
// `@catppuccin-filters` maps at the top of the file are preserved so that
// userstyles referencing `@catppuccin[@@flavor][@@X]` still resolve (to the
// Mocha/whatever defaults — they compile to hex literals that survive in the
// output where our rewriter didn't reach).
const REAL_LIB = await Deno.readTextFile("upstream/catppuccin/lib/lib.less");

// Strip the `#lib { ... }` block including its closing brace. postcss-less
// isn't reliable round-tripping the whole file (corrupts `#lib.rgbify` back
// to `@lib.rgbify` on serialize) so we do a minimal string surgery.
function stripLibBlock(src: string): string {
  const start = src.indexOf("#lib {");
  if (start === -1) return src;
  // Find matching closing brace by depth counting.
  let depth = 0, i = start;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(0, start) + src.slice(i);
}

const PATCHED_LIB_LESS = `
${stripLibBlock(REAL_LIB)}

#lib {
  .palette() {
${PALETTE_TOKENS.map(([k, v]) => `    @${k}: ${v}; @${k}-filter: none;`).join("\n")}
  }
  .defaults() {
    color-scheme: dark;
    ::selection { background-color: rgb(from var(--ctp-accent) r g b / 0.3); }
    input, textarea {
      &::placeholder { color: var(--ctp-subtext0) !important; }
    }
  }
  .rgbify(@color) {
    @rgb: red(@color), green(@color), blue(@color);
  }
  .hslify(@color) {
    @raw: e(%("%s, %s%, %s%", hue(@color), saturation(@color), lightness(@color)));
  }
  .css-variables() { /* no-op — runtime :root override handles this */ }
}
`;

const IMPORT_RE =
  /@import\s+["']https:\/\/userstyles\.catppuccin\.com\/lib\/lib\.less["'];?/g;

// Extract Stylus @var declarations from the ==UserStyle== metadata block so
// LESS globals can be seeded with a default (Stylus would normally substitute
// these at install time based on user selection). Returns a map of LESS var
// names to default values. We pick the default-marked option (`*` suffix) for
// select types, or the third field for other types.
function extractStylusVarDefaults(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const metaStart = source.indexOf("==UserStyle==");
  const metaEnd = source.indexOf("==/UserStyle==");
  if (metaStart === -1 || metaEnd === -1) return out;
  const meta = source.slice(metaStart, metaEnd);

  // Matches: @var <type> <name> "<label>" <data>
  // Names may contain hyphens ([\w-]+). <data> shapes vary by type.
  const lineRe = /@var\s+(\w+)\s+([\w-]+)\s+"[^"]*"\s+(.+)/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(meta)) !== null) {
    const type = m[1];
    const name = m[2];
    const rest = m[3].trim();

    if (type === "select" || type === "dropdown") {
      // Options are `["key:Label", "key2:Label2*", ...]`. `*` marks default.
      const list = rest.match(/\[([^\]]+)\]/)?.[1] ?? "";
      const entries = [...list.matchAll(/"([^"]+)"/g)].map((e) => e[1]);
      const starred = entries.find((e) => /\*(:[^:]*)?$/.test(e)) ?? entries[0];
      out[name] = (starred ?? "").replace(/:.*$/, "").replace(/\*$/, "");
    } else if (type === "checkbox") {
      out[name] = rest === "1" ? "1" : "0";
    } else if (type === "number" || type === "range") {
      // range format: [default, min, max, step] — first numeric token wins.
      const first = rest.match(/-?\d+(?:\.\d+)?/)?.[0];
      if (first !== undefined) out[name] = first;
    } else if (type === "color") {
      const hex = rest.match(/#[0-9a-fA-F]{3,8}/)?.[0];
      if (hex) out[name] = hex;
    } else if (type === "text") {
      const str = rest.match(/"([^"]*)"/)?.[1];
      if (str !== undefined) out[name] = str;
    }
  }
  return out;
}

// postcss-less parses LESS mixin calls like `#catppuccin(@flavor)` fine, but
// corrupts them on serialize — the leading `#` becomes `@`. Real CSS at-rules
// (@media, @supports, @-moz-document, etc.) also use `@`, so we post-fix by
// whitelisting standard at-rules and restoring `#` for everything else.
const STANDARD_AT_RULES = new Set([
  "media", "supports", "import", "charset", "keyframes", "font-face",
  "page", "viewport", "namespace", "document", "-moz-document",
  "-moz-keyframes", "-webkit-keyframes", "container", "layer", "property",
  "scope", "starting-style", "counter-style",
]);

// postcss-less rewrites several LESS constructs on serialize:
//   #name(...)  →  @name(...)   (ID mixin calls / rule selectors)
//   .name(...)  →  @name(...)   (class mixin calls — definitions survive)
//   each(...)   →  @each(...)   (LESS built-ins without prefix)
//   #name() !important; →  @name() ;   (also strips `!important`)
// We restore the prefix by checking the *original* source for the token, and
// re-insert `!important` where it was dropped.
const CORRUPTED_AT_RE = /@([-\w.]+)\(/g;
const escapeRegex = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");

function restoreLessMixins(serialized: string, original: string): string {
  // Pass 1: restore `#` / `.` / bare prefix on every `@<name>(`.
  let out = serialized.replace(CORRUPTED_AT_RE, (whole, name: string) => {
    const head = name.toLowerCase().split(".")[0];
    if (STANDARD_AT_RULES.has(head)) return whole;
    const esc = escapeRegex(name);
    if (new RegExp(`#${esc}\\s*\\(`).test(original)) return `#${name}(`;
    if (new RegExp(`\\.${esc}\\s*\\(`).test(original)) return `.${name}(`;
    return `${name}(`;
  });

  // Pass 2: reinstate `!important` dropped from mixin calls. Signature after
  // pass 1 is `<prefix><name>(<args>)<ws>;` with at least one whitespace
  // before the semicolon (postcss-less leaves that whitespace when it drops
  // the `!important` token). Only re-add when the original source shows the
  // call immediately followed by `!important`.
  out = out.replace(
    /([#.])([-\w.]+)\s*\(([^)]*)\)(\s+);/g,
    (whole, prefix, name, args) => {
      const esc = escapeRegex(name);
      const callRe = new RegExp(
        `\\${prefix}${esc}\\s*\\([^)]*\\)\\s*!important`,
      );
      if (callRe.test(original)) {
        return `${prefix}${name}(${args}) !important;`;
      }
      return whole;
    },
  );

  return out;
}

// Drop LESS single-line `// ...` comments before postcss-less sees them.
// postcss-less round-trips `//` as a block comment on serialize, which breaks
// when the comment body happens to contain `*/` (seen in the wild on lastfm:
// `// TODO: https://www.last.fm/user/*/listening-report/week`). LESS strips
// `//` comments during compilation anyway, so we lose nothing by dropping
// them up front. The lookbehind rejects `//` when preceded by `:` (protocol
// URLs like `https://`) or quotes (protocol-relative URLs in strings like
// `url("//assets.jisho.org/...")`).
const LESS_LINE_COMMENT_RE = /(?<![:"'])\/\/[^\n]*/g;

// Turn standalone `.mixin;` / `#mixin;` (a class/id mixin call without parens)
// into `.mixin();` / `#mixin();`. Modern LESS parses the unparenthesized form
// as a namespace-lookup expression and errors with "Missing '[...]' lookup in
// variable call" (seen on canvas-lms line 1939 — one stray `.flush-button;`
// where every sibling is `.flush-button();`). Line-scoped so we don't touch
// declarations or selectors.
const BARE_MIXIN_CALL_RE = /^([ \t]*)([.#][A-Za-z_][\w-]*)\s*;[ \t]*$/gm;

function sanitizeForPostcssLess(source: string): string {
  return source
    .replace(LESS_LINE_COMMENT_RE, "")
    .replace(BARE_MIXIN_CALL_RE, "$1$2();");
}

function rewriteLessSource(source: string): string {
  const sanitized = sanitizeForPostcssLess(source);
  const root = postcssLess.parse(sanitized);
  root.walkDecls((decl) => {
    const next = rewriteValue(decl.value);
    if (next !== decl.value) decl.value = next;
  });
  return restoreLessMixins(root.toString(), sanitized);
}

export type CompileResult = {
  css: string;
  warnings: string[];
};

export async function compileUserLess(source: string): Promise<CompileResult> {
  const warnings: string[] = [];

  // Rewrite palette uses and color math.
  const rewritten = rewriteLessSource(source);

  // Swap @import for the stub. If the @import is missing (some local forks
  // might inline the lib), leave as-is.
  const withLib = rewritten.includes("https://userstyles.catppuccin.com/lib/lib.less")
    ? rewritten.replace(IMPORT_RE, PATCHED_LIB_LESS)
    : PATCHED_LIB_LESS + "\n" + rewritten;

  // Stylus-specific @var declarations live inside the ==UserStyle== comment
  // block, so LESS won't see them. Seed their defaults as LESS globals.
  const stylusDefaults = extractStylusVarDefaults(source);
  const globalVars: Record<string, string> = {
    lightFlavor: "mocha",
    darkFlavor: "mocha",
    accentColor: "mauve",
    ...stylusDefaults,
  };

  const result = await less.render(withLib, {
    globalVars,
    math: "parens-division",
    strictImports: false,
    javascriptEnabled: false,
  } as unknown as Less.Options);

  // Our output is already-compiled CSS (LESS math, mixin expansion, and var
  // resolution all happened above). Stylus sees `@preprocessor less` in the
  // metadata and would re-compile — at which point our `hsl(from var(...) ...)`
  // CSS relative-color syntax looks like an unknown LESS call and blows up.
  // Strip the directive so Stylus treats the payload as plain CSS.
  const css = stripPreprocessorDirective(result.css);

  return { css, warnings };
}

function stripPreprocessorDirective(css: string): string {
  // Only touch the ==UserStyle== metadata block. Match a line containing
  // `@preprocessor …` and drop it entirely. Any other `@preprocessor` in the
  // body would be unusual but we only rewrite within the metadata block.
  const metaOpen = css.indexOf("==UserStyle==");
  const metaClose = css.indexOf("==/UserStyle==");
  if (metaOpen === -1 || metaClose === -1 || metaClose < metaOpen) return css;

  const before = css.slice(0, metaOpen);
  const meta = css.slice(metaOpen, metaClose);
  const after = css.slice(metaClose);
  const cleanedMeta = meta.replace(/^[ \t]*@preprocessor[^\n]*\n?/gm, "");
  return before + cleanedMeta + after;
}

// Minimal type shim — the Deno/npm bridge's bundled Less.Options type is
// surprisingly incomplete for the fields we use.
declare namespace Less {
  interface Options {
    globalVars?: Record<string, string>;
    math?: string;
    strictImports?: boolean;
    javascriptEnabled?: boolean;
  }
}
