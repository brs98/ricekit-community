// Rewrite @updateURL and @version inside a userstyle's ==UserStyle== metadata
// block. If either directive is missing, insert it just before the closing
// ==/UserStyle== marker. Everything outside the metadata block is untouched.
//
// Pure function, no I/O. Used by stamp-meta.ts to batch-process build/dist.

export type MetaRewrite = {
  updateUrl: string;
  version: string;
};

const OPEN_MARKER = "==UserStyle==";
const CLOSE_MARKER = "==/UserStyle==";

// Match a metadata directive at the start of a line (after optional leading
// whitespace / `*` continuation). `@name X` or `@updateURL URL` shape.
function directiveLineRegex(name: string): RegExp {
  return new RegExp(`^([ \\t]*\\*?[ \\t]*)@${name}[ \\t]+[^\\n]*$`, "m");
}

export function rewriteMeta(source: string, { updateUrl, version }: MetaRewrite): string {
  const openIdx = source.indexOf(OPEN_MARKER);
  const closeIdx = source.indexOf(CLOSE_MARKER);
  if (openIdx === -1 || closeIdx === -1 || closeIdx < openIdx) {
    throw new Error("rewriteMeta: no ==UserStyle== block found");
  }

  const before = source.slice(0, openIdx);
  const meta = source.slice(openIdx, closeIdx);
  const after = source.slice(closeIdx);

  let nextMeta = meta;
  const urlRe = directiveLineRegex("updateURL");
  const verRe = directiveLineRegex("version");

  nextMeta = urlRe.test(nextMeta)
    ? nextMeta.replace(urlRe, `$1@updateURL ${updateUrl}`)
    : insertDirective(nextMeta, `@updateURL ${updateUrl}`);

  nextMeta = verRe.test(nextMeta)
    ? nextMeta.replace(verRe, `$1@version ${version}`)
    : insertDirective(nextMeta, `@version ${version}`);

  return before + nextMeta + after;
}

// Insert a `@foo value` line at the end of the metadata block (just before
// CLOSE_MARKER). We trim any trailing blank line so successive inserts stay
// tidy.
function insertDirective(meta: string, line: string): string {
  const trimmed = meta.replace(/[ \t]*\n*$/, "");
  return `${trimmed}\n${line}\n`;
}
