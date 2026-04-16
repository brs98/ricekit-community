// Compile every Catppuccin userstyle to .user.css under ricekit/build/dist.
// Reports failures per-site but keeps going — one broken userstyle shouldn't
// block the other 133.
import { join } from "jsr:@std/path@^1.0.8";
import { compileUserLess } from "./compile.ts";

const STYLES_DIR = "upstream/catppuccin/styles";
const OUT_DIR = "./build/dist";

await Deno.mkdir(OUT_DIR, { recursive: true });

const entries: { site: string; path: string }[] = [];
for await (const entry of Deno.readDir(STYLES_DIR)) {
  if (!entry.isDirectory) continue;
  const path = join(STYLES_DIR, entry.name, "catppuccin.user.less");
  try {
    await Deno.stat(path);
    entries.push({ site: entry.name, path });
  } catch {
    // no catppuccin.user.less — skip
  }
}
entries.sort((a, b) => a.site.localeCompare(b.site));

let ok = 0, fail = 0;
const failures: { site: string; error: string }[] = [];

for (const { site, path } of entries) {
  try {
    const src = await Deno.readTextFile(path);
    const { css } = await compileUserLess(src);
    await Deno.writeTextFile(join(OUT_DIR, `${site}.user.css`), css);
    ok++;
  } catch (e) {
    fail++;
    failures.push({
      site,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

console.log(`\n=== build complete: ${ok}/${entries.length} ok, ${fail} failed ===`);
if (failures.length > 0) {
  console.log("\n-- failures --");
  for (const { site, error } of failures) {
    console.log(`  ${site}: ${error.split("\n")[0].slice(0, 120)}`);
  }
}
