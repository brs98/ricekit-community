// Rewrite directives inside a userstyle's ==UserStyle== metadata block:
//   - @updateURL and @version are always rewritten (required fields).
//   - @name, @namespace, @homepageURL, @supportURL, @description are rewritten
//     if the caller provides a value; left alone otherwise.
//   - @var select / @var dropdown lines are stripped entirely when
//     stripVarSelects is true (they're dead weight once the palette is rewritten
//     to var(--rk-*) — Stylus's UI dropdowns no longer control anything).
// Missing directives are inserted just before ==/UserStyle==. Everything outside
// the metadata block is untouched.
//
// Pure function, no I/O. Used by stamp-meta.ts to batch-process build/dist.

export type MetaRewrite = {
  updateUrl: string;
  version: string;
  name?: string;
  namespace?: string;
  homepageURL?: string;
  supportURL?: string;
  description?: string;
  stripVarSelects?: boolean;
};

const OPEN_MARKER = "==UserStyle==";
const CLOSE_MARKER = "==/UserStyle==";

// Match a metadata directive at the start of a line (after optional leading
// whitespace / `*` continuation). `@name X` or `@updateURL URL` shape.
function directiveLineRegex(name: string): RegExp {
  return new RegExp(`^([ \\t]*\\*?[ \\t]*)@${name}[ \\t]+[^\\n]*$`, "m");
}

// Match @var select / @var dropdown lines. These are the Stylus UI selectors
// Catppuccin uses for lightFlavor / darkFlavor / accentColor — once our
// compile step bakes the palette out to var(--rk-*), they do nothing. Strip
// them to declutter the Stylus style editor.
const VAR_SELECT_LINE_RE = /^[ \t]*\*?[ \t]*@var[ \t]+(?:select|dropdown)[ \t]+[^\n]*\n?/gm;

export function rewriteMeta(source: string, opts: MetaRewrite): string {
  const openIdx = source.indexOf(OPEN_MARKER);
  const closeIdx = source.indexOf(CLOSE_MARKER);
  if (openIdx === -1 || closeIdx === -1 || closeIdx < openIdx) {
    throw new Error("rewriteMeta: no ==UserStyle== block found");
  }

  const before = source.slice(0, openIdx);
  let meta = source.slice(openIdx, closeIdx);
  const after = source.slice(closeIdx);

  if (opts.stripVarSelects) {
    meta = meta.replace(VAR_SELECT_LINE_RE, "");
  }

  const rewrites: [string, string | undefined][] = [
    ["updateURL", opts.updateUrl],
    ["version", opts.version],
    ["name", opts.name],
    ["namespace", opts.namespace],
    ["homepageURL", opts.homepageURL],
    ["supportURL", opts.supportURL],
    ["description", opts.description],
  ];
  for (const [directive, value] of rewrites) {
    if (value === undefined) continue;
    const re = directiveLineRegex(directive);
    meta = re.test(meta)
      ? meta.replace(re, `$1@${directive} ${value}`)
      : insertDirective(meta, `@${directive} ${value}`);
  }

  return before + meta + after;
}

// Insert a `@foo value` line at the end of the metadata block (just before
// CLOSE_MARKER). We trim any trailing blank line so successive inserts stay
// tidy.
function insertDirective(meta: string, line: string): string {
  const trimmed = meta.replace(/[ \t]*\n*$/, "");
  return `${trimmed}\n${line}\n`;
}
