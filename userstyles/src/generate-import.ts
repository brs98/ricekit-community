// Produce a Stylus backup JSON that installs every compiled userstyle in one
// click (Stylus → Manage Styles → Import → select this file).
// Format matches what Stylus's own backup/restore feature writes out, with
// the compiled .user.css content shipped inline via `sourceCode`.
import usercssMeta from "npm:usercss-meta@0.12.0";
import { calcStyleDigest } from "https://github.com/openstyles/stylus/raw/8fe35a4b90d85fb911bd7aa1deab4e4733c31150/src/js/sections-util.js";
import { join } from "jsr:@std/path@^1.0.8";

const DIST_DIR = "./build/dist";
const OUT_FILE = "./build/import.json";

const settings = {
  settings: {
    updateInterval: 24,
    updateOnlyEnabled: true,
    patchCsp: true,
    "editor.linter": "",
  },
};

const entries: Record<string, unknown>[] = [settings];

const files: string[] = [];
for await (const entry of Deno.readDir(DIST_DIR)) {
  if (entry.isFile && entry.name.endsWith(".user.css")) {
    files.push(entry.name);
  }
}
files.sort();

for (const name of files) {
  const path = join(DIST_DIR, name);
  const content = await Deno.readTextFile(path);
  const { metadata } = usercssMeta.parse(content);

  const userstyle: Record<string, unknown> = {
    enabled: true,
    name: metadata.name,
    description: metadata.description,
    author: metadata.author,
    url: metadata.url,
    updateUrl: metadata.updateURL,
    usercssData: metadata,
    sourceCode: content,
  };
  userstyle.originalDigest = await calcStyleDigest(userstyle);
  entries.push(userstyle);
}

await Deno.writeTextFile(OUT_FILE, JSON.stringify(entries));
console.log(
  `wrote ${OUT_FILE}: ${entries.length - 1} userstyles + settings header`,
);
