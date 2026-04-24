// Compile every Catppuccin userstyle to .user.css under userstyles/build/dist.
// Also renders native Ricekit styles from userstyles/styles/.
// Reports failures per-site but keeps going — one broken userstyle shouldn't
// block the others.
import { dirname, join } from "jsr:@std/path@^1.0.8";
import { parse } from "jsr:@std/toml@^1.0.6";
import { compileUserLess } from "./compile.ts";
import { renderNativeUserStyle, type NativeStyleInput } from "./native-style.ts";

const UPSTREAM_STYLES_DIR = "upstream/catppuccin/styles";
const NATIVE_STYLES_DIR = "styles";
const OUT_DIR = "./build/dist";

await Deno.mkdir(OUT_DIR, { recursive: true });

type UpstreamEntry = { site: string; path: string };

async function collectUpstreamStyles(): Promise<UpstreamEntry[]> {
  const entries: UpstreamEntry[] = [];
  try {
    for await (const entry of Deno.readDir(UPSTREAM_STYLES_DIR)) {
      if (!entry.isDirectory) continue;
      const path = join(UPSTREAM_STYLES_DIR, entry.name, "catppuccin.user.less");
      try {
        await Deno.stat(path);
        entries.push({ site: entry.name, path });
      } catch {
        // no catppuccin.user.less — skip
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.warn(`warning: ${UPSTREAM_STYLES_DIR} is missing; run git submodule update --init userstyles/upstream/catppuccin`);
      return entries;
    }
    throw error;
  }
  entries.sort((a, b) => a.site.localeCompare(b.site));
  return entries;
}

async function collectNativeStyles(): Promise<NativeStyleInput[]> {
  const entries: NativeStyleInput[] = [];
  for await (const entry of Deno.readDir(NATIVE_STYLES_DIR)) {
    if (!entry.isDirectory) continue;
    const dir = join(NATIVE_STYLES_DIR, entry.name);
    const manifestPath = join(dir, "ricekit.toml");
    const cssPath = join(dir, "ricekit.css");

    try {
      const manifest = parse(await Deno.readTextFile(manifestPath)) as Record<string, unknown>;
      const css = await Deno.readTextFile(cssPath);
      entries.push({
        slug: entry.name,
        name: stringField(manifest, "name", manifestPath),
        description: stringField(manifest, "description", manifestPath),
        author: stringField(manifest, "author", manifestPath),
        domains: stringArrayField(manifest, "domains", manifestPath),
        desktopTargets: stringArrayField(manifest, "desktop_targets", manifestPath),
        css,
      });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
  }
  entries.sort((a, b) => a.slug.localeCompare(b.slug));
  return entries;
}

function stringField(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path}: ${key} must be a non-empty string`);
  }
  return value;
}

function stringArrayField(source: Record<string, unknown>, key: string, path: string): string[] {
  const value = source[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${path}: ${key} must be a non-empty string array`);
  }
  return value as string[];
}

let upstreamOk = 0;
let upstreamFail = 0;
const failures: { site: string; error: string }[] = [];

for (const { site, path } of await collectUpstreamStyles()) {
  try {
    const src = await Deno.readTextFile(path);
    const { css } = await compileUserLess(src);
    await Deno.writeTextFile(join(OUT_DIR, `${site}.user.css`), css);
    upstreamOk++;
  } catch (e) {
    upstreamFail++;
    failures.push({
      site,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

let nativeOk = 0;
let nativeFail = 0;
for (const nativeStyle of await collectNativeStyles()) {
  try {
    const rendered = renderNativeUserStyle(nativeStyle);
    await Deno.writeTextFile(join(OUT_DIR, `${nativeStyle.slug}.user.css`), rendered.userCss);
    for (const copy of rendered.desktopCopies) {
      await Deno.mkdir(dirname(copy.path), { recursive: true });
      await Deno.writeTextFile(copy.path, copy.css);
    }
    nativeOk++;
  } catch (e) {
    nativeFail++;
    failures.push({
      site: `native:${nativeStyle.slug}`,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

console.log(`\n=== build complete: ${upstreamOk} upstream ok, ${nativeOk} native ok, ${upstreamFail + nativeFail} failed ===`);
if (failures.length > 0) {
  console.log("\n-- failures --");
  for (const { site, error } of failures) {
    console.log(`  ${site}: ${error.split("\n")[0].slice(0, 120)}`);
  }
}
