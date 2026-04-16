// Smoke test: compile one Catppuccin userstyle end-to-end.
import { compileUserLess } from "./compile.ts";

const site = Deno.args[0] ?? "github";
const src = await Deno.readTextFile(`upstream/catppuccin/styles/${site}/catppuccin.user.less`);

const { css } = await compileUserLess(src);
const lines = css.split("\n");
const ctpLines = lines.filter((l) => l.includes("var(--ctp-"));
const relColorLines = lines.filter((l) =>
  /rgb\(from |hsl\(from |color-mix\(/.test(l)
);

console.log(`=== ${site}: ${lines.length} lines, ${css.length} chars ===`);
console.log(`  var(--ctp-*)        : ${ctpLines.length} occurrences`);
console.log(`  relative-color / mix: ${relColorLines.length} occurrences`);

console.log("\n-- sample var(--ctp-*) lines --");
console.log(ctpLines.slice(0, 8).join("\n"));
console.log("\n-- sample relative-color lines --");
console.log(relColorLines.slice(0, 5).join("\n"));
