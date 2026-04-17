// Walk build/dist/*.user.css, rewrite @updateURL to point at our repo's raw
// URL for that exact file, and stamp @version with a monotonic build suffix.
// One build run = one shared stamp across every file.
//
// Run after build.ts (which writes the compiled .user.css) and before
// generate-import.ts (which reads the stamped files to embed in import.json).

import { join } from "jsr:@std/path@^1.0.8";
import { rewriteMeta } from "./rewrite-meta.ts";

const DIST_DIR = "./build/dist";
const RAW_URL_BASE =
  "https://raw.githubusercontent.com/brs98/ricekit-community/main/userstyles/build/dist";

function buildStamp(now = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    now.getUTCFullYear().toString() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes())
  );
}

function extractUpstreamVersion(source: string): string | null {
  const m = source.match(/^[ \t]*\*?[ \t]*@version[ \t]+([^\s]+)/m);
  return m ? m[1] : null;
}

// Allow CI (and local reproducers) to pin the stamp via env var. This makes
// `deno task build` reproducible: given the same sources + the same stamp,
// dist/ is byte-identical. The PR staleness check (see
// .github/workflows/check-userstyles-build.yml) extracts the stamp from the
// committed dist and feeds it back in so its rebuild matches.
const stamp = Deno.env.get("USERSTYLES_BUILD_STAMP") ?? buildStamp();
let stamped = 0;

for await (const entry of Deno.readDir(DIST_DIR)) {
  if (!entry.isFile || !entry.name.endsWith(".user.css")) continue;

  const path = join(DIST_DIR, entry.name);
  const src = await Deno.readTextFile(path);

  const upstream = extractUpstreamVersion(src);
  const version = upstream ? `${upstream}.${stamp}` : stamp;

  const rewritten = rewriteMeta(src, {
    updateUrl: `${RAW_URL_BASE}/${entry.name}`,
    version,
  });
  await Deno.writeTextFile(path, rewritten);
  stamped++;
}

console.log(`stamped ${stamped} userstyles (build stamp: ${stamp})`);
