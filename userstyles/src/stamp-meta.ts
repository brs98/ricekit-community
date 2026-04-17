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
const NAMESPACE = "github.com/brs98/ricekit-community/userstyles";
const HOMEPAGE_URL = "https://github.com/brs98/ricekit-community/tree/main/userstyles";
const SUPPORT_URL = "https://github.com/brs98/ricekit-community/issues";

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

// Pull the pretty site name out of the current @name directive. Upstream
// Catppuccin uses the uniform shape "{Site} Catppuccin" (e.g., "GitHub
// Catppuccin", "Google Maps Catppuccin"), so we strip a trailing " Catppuccin"
// case-insensitively. Returns null for styles that don't match — those get
// left alone rather than renamed by a bad guess.
function extractSiteName(source: string): string | null {
  const m = source.match(/^[ \t]*\*?[ \t]*@name[ \t]+([^\n]+?)[ \t]*$/m);
  if (!m) return null;
  const trimmed = m[1].trim();
  const stripped = trimmed.replace(/\s+Catppuccin$/i, "");
  return stripped === trimmed ? null : stripped;
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
  const siteName = extractSiteName(src);

  const rewritten = rewriteMeta(src, {
    updateUrl: `${RAW_URL_BASE}/${entry.name}`,
    version,
    namespace: NAMESPACE,
    homepageURL: HOMEPAGE_URL,
    supportURL: SUPPORT_URL,
    stripVarSelects: true,
    // Name + description depend on the extracted site name — skip the rebrand
    // for styles that don't match the upstream "{Site} Catppuccin" convention
    // (e.g., ricekit-native styles under userstyles/styles/).
    ...(siteName !== null
      ? {
        name: `${siteName} Ricekit`,
        description: `Ricekit version of Catppuccin for ${siteName}`,
      }
      : {}),
  });
  await Deno.writeTextFile(path, rewritten);
  stamped++;
}

console.log(`stamped ${stamped} userstyles (build stamp: ${stamp})`);
