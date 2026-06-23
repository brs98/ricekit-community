// Walk build/dist/*.user.css, rewrite @updateURL to point at our repo's raw
// URL for that exact file, and stamp @version with a monotonic build suffix.
// Files whose stamped output is byte-identical to the committed copy keep their
// existing @version, so upstream bump PRs only update styles that actually
// changed.
//
// Run after build.ts (which writes the compiled .user.css) and before
// generate-import.ts (which reads the stamped files to embed in import.json).

import { type MetaRewrite, rewriteMeta } from "./rewrite-meta.ts";

// Some editor LSPs in this repo attach TypeScript rather than Deno to files
// with `import.meta.main`. Keep the runtime Deno access typed locally so both
// Deno and the editor agree on this module.
type DenoLike = {
  cwd(): string;
  env: { get(name: string): string | undefined };
  readDir(path: string): AsyncIterable<{ isFile: boolean; name: string }>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
  Command: new (
    command: string,
    options: {
      args: string[];
      cwd: string;
      stdout: "piped";
      stderr: "null";
    },
  ) => { output(): Promise<{ code: number; stdout: Uint8Array }> };
};

const deno = (globalThis as typeof globalThis & { Deno: DenoLike }).Deno;

const DIST_DIR = "./build/dist";
const RAW_URL_BASE =
  "https://raw.githubusercontent.com/brs98/ricekit-community/main/userstyles/build/dist";
const NAMESPACE = "github.com/brs98/ricekit-community/userstyles";
const HOMEPAGE_URL =
  "https://github.com/brs98/ricekit-community/tree/main/userstyles";
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

function extractVersion(source: string): string | null {
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

function versionIncludesUpstreamVersion(
  version: string,
  upstreamVersion: string | null,
): boolean {
  if (upstreamVersion === null) {
    return /^[0-9]{12}$/.test(version);
  }
  return version.startsWith(`${upstreamVersion}.`) &&
    /\.[0-9]{12}$/.test(version);
}

function rewriteOptions(
  source: string,
  fileName: string,
  version: string,
): MetaRewrite {
  const siteName = extractSiteName(source);
  return {
    updateUrl: `${RAW_URL_BASE}/${fileName}`,
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
  };
}

export function chooseVersion(
  source: string,
  previous: string | null,
  nextVersion: string,
): string {
  if (previous === null) return nextVersion;

  const previousVersion = extractVersion(previous);
  if (previousVersion === null) return nextVersion;

  const upstreamVersion = extractVersion(source);
  if (!versionIncludesUpstreamVersion(previousVersion, upstreamVersion)) {
    return nextVersion;
  }

  // If the current compiled source, stamped with the previous version, exactly
  // matches the committed file, the user-visible style did not change. Keeping
  // the old version avoids making Stylus update unaffected styles.
  const fileName = "__comparison__.user.css";
  const previousFileName = extractUpdateFileName(previous) ?? fileName;
  const candidate = rewriteMeta(
    source,
    rewriteOptions(source, previousFileName, previousVersion),
  );
  return candidate === previous ? previousVersion : nextVersion;
}

function extractUpdateFileName(source: string): string | null {
  const m = source.match(/^[ \t]*\*?[ \t]*@updateURL[ \t]+([^\s]+)/m);
  if (!m) return null;
  const raw = m[1].trim();
  const slash = raw.lastIndexOf("/");
  return slash === -1 ? raw : raw.slice(slash + 1);
}

async function gitOutput(
  args: string[],
  cwd = deno.cwd(),
  trim = true,
): Promise<string | null> {
  try {
    const command = new deno.Command("git", {
      args,
      cwd,
      stdout: "piped",
      stderr: "null",
    });
    const { code, stdout } = await command.output();
    if (code !== 0) return null;
    const text = new TextDecoder().decode(stdout);
    return trim ? text.trimEnd() : text;
  } catch {
    return null;
  }
}

type GitContext = {
  root: string;
  prefix: string;
};

async function gitContext(): Promise<GitContext | null> {
  const root = await gitOutput(["rev-parse", "--show-toplevel"]);
  const prefix = await gitOutput(["rev-parse", "--show-prefix"]);
  if (root === null || prefix === null) return null;
  return { root, prefix };
}

function repoPath(context: GitContext, path: string): string {
  const normalized = path.replace(/^\.\//, "").replaceAll("\\", "/");
  return `${context.prefix}${normalized}`;
}

async function readCommittedFile(
  context: GitContext | null,
  path: string,
): Promise<string | null> {
  if (context === null) return null;
  const relativePath = repoPath(context, path);
  return await gitOutput(["show", `HEAD:${relativePath}`], context.root, false);
}

export async function main(): Promise<void> {
  // Allow CI (and local reproducers) to pin the stamp via env var. Given the
  // same sources and stamp, changed files are byte-identical; unchanged files
  // keep their committed versions.
  const stamp = deno.env.get("USERSTYLES_BUILD_STAMP") ?? buildStamp();
  const context = await gitContext();
  let stamped = 0;
  let preserved = 0;

  for await (const entry of deno.readDir(DIST_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".user.css")) continue;

    const path = joinPath(DIST_DIR, entry.name);
    const src = await deno.readTextFile(path);

    const upstream = extractVersion(src);
    const nextVersion = upstream ? `${upstream}.${stamp}` : stamp;
    const previous = await readCommittedFile(context, path);
    const version = chooseVersion(src, previous, nextVersion);

    const rewritten = rewriteMeta(
      src,
      rewriteOptions(src, entry.name, version),
    );
    await deno.writeTextFile(path, rewritten);
    stamped++;
    if (version !== nextVersion) preserved++;
  }

  const suffix = preserved > 0
    ? `, preserved ${preserved} unchanged versions`
    : "";
  console.log(`stamped ${stamped} userstyles (build stamp: ${stamp}${suffix})`);
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

if ((import.meta as ImportMeta & { main?: boolean }).main) {
  await main();
}
