// Dump the rewritten LESS source (before LESS compilation) for a site, so we
// can compare against the original to find round-trip issues.
import postcssLess from "npm:postcss-less@6.0.0";
import { rewriteValue } from "./rewrite-less.ts";

const site = Deno.args[0] ?? "chess.com";
const src = await Deno.readTextFile(`upstream/catppuccin/styles/${site}/catppuccin.user.less`);

const STANDARD_AT_RULES = new Set([
  "media", "supports", "import", "charset", "keyframes", "font-face",
  "page", "viewport", "namespace", "document", "-moz-document",
  "-moz-keyframes", "-webkit-keyframes", "container", "layer", "property",
  "scope", "starting-style", "counter-style",
]);
const CORRUPTED_AT_RE = /@([A-Za-z_][\w.-]*)\(/g;

const root = postcssLess.parse(src);
root.walkDecls((d) => (d.value = rewriteValue(d.value)));
const rewritten = root.toString().replace(CORRUPTED_AT_RE, (w, n: string) => {
  const head = n.toLowerCase().split(".")[0];
  return STANDARD_AT_RULES.has(head) ? w : `#${n}(`;
});

// Find the #catppuccin definition
const lines = rewritten.split("\n");
const defIdx = lines.findIndex((l) => /catppuccin\s*\(/.test(l) && /\{/.test(l));
console.log(`-- lines around #catppuccin definition (idx ${defIdx}) --`);
console.log(lines.slice(Math.max(0, defIdx - 2), defIdx + 5).join("\n"));

const callIdx = lines.findIndex((l, i) =>
  i !== defIdx && /catppuccin\s*\(/.test(l)
);
console.log(`\n-- first call site (idx ${callIdx}) --`);
console.log(lines.slice(Math.max(0, callIdx - 1), callIdx + 3).join("\n"));

// Compare with original
const origLines = src.split("\n");
const origDefIdx = origLines.findIndex((l) =>
  /#catppuccin\s*\(/.test(l) && /\{/.test(l)
);
console.log(`\n-- original definition (line ${origDefIdx + 1}) --`);
console.log(origLines.slice(Math.max(0, origDefIdx - 1), origDefIdx + 3).join("\n"));
