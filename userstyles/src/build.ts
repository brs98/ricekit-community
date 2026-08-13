// Build distributable userstyles while preserving each source format.
// Catppuccin LESS is transformed locally and validated against Ricekit's
// standard-library adapter. A rejected style is omitted without failing the
// complete build.

import less from "npm:less@4.2.1";
import { dirname, join } from "jsr:@std/path@^1.0.8";
import { parse } from "jsr:@std/toml@^1.0.6";
import {
  type NativeStyleInput,
  renderNativeUserStyle,
} from "./native-style.ts";
import { transformUserLess } from "./transform.ts";

const DEFAULT_UPSTREAM_STYLES_DIR = "upstream/catppuccin/styles";
const DEFAULT_NATIVE_STYLES_DIR = "styles";
const DEFAULT_OUT_DIR = "build/dist";
const DEFAULT_ADAPTER_PATH = "lib/std/v1.less";
const RICEKIT_IMPORT_RE =
  /@import\s+["']https:\/\/raw\.githubusercontent\.com\/brs98\/ricekit-community\/main\/userstyles\/lib\/std\/v1\.less["']\s*;/;

export type BuildOptions = {
  upstreamStylesDir?: string;
  nativeStylesDir?: string;
  outDir?: string;
  adapterPath?: string;
};

export type BuildFailure = { site: string; error: string };

export type BuildResult = {
  upstreamTotal: number;
  upstreamOk: number;
  nativeOk: number;
  failures: BuildFailure[];
};

type UpstreamEntry = { site: string; path: string };

export async function buildUserStyles(
  options: BuildOptions = {},
): Promise<BuildResult> {
  const upstreamStylesDir = options.upstreamStylesDir ??
    DEFAULT_UPSTREAM_STYLES_DIR;
  const nativeStylesDir = options.nativeStylesDir ?? DEFAULT_NATIVE_STYLES_DIR;
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const adapter = await Deno.readTextFile(
    options.adapterPath ?? DEFAULT_ADAPTER_PATH,
  );
  const upstream = await collectUpstreamStyles(upstreamStylesDir);
  const native = await collectNativeStyles(nativeStylesDir);
  const outputs = new Map<string, string>();
  const desktopCopies: { path: string; css: string }[] = [];
  const failures: BuildFailure[] = [];
  let upstreamOk = 0;
  let nativeOk = 0;

  for (const { site, path } of upstream) {
    try {
      const source = await Deno.readTextFile(path);
      const transformed = transformUserLess(source);
      await validateUserLess(transformed, source, adapter);
      outputs.set(`${site}.user.less`, transformed);
      upstreamOk++;
    } catch (error) {
      failures.push({ site, error: errorMessage(error) });
    }
  }

  for (const nativeStyle of native) {
    try {
      const rendered = renderNativeUserStyle(nativeStyle);
      outputs.set(`${nativeStyle.slug}.user.css`, rendered.userCss);
      desktopCopies.push(...rendered.desktopCopies);
      nativeOk++;
    } catch (error) {
      failures.push({
        site: `native:${nativeStyle.slug}`,
        error: errorMessage(error),
      });
    }
  }

  await reconcileDist(outDir, outputs);
  for (const copy of desktopCopies) {
    await Deno.mkdir(dirname(copy.path), { recursive: true });
    await Deno.writeTextFile(copy.path, copy.css);
  }

  return { upstreamTotal: upstream.length, upstreamOk, nativeOk, failures };
}

async function validateUserLess(
  transformed: string,
  original: string,
  adapter: string,
): Promise<void> {
  const importMatch = transformed.match(RICEKIT_IMPORT_RE);
  if (!importMatch) {
    throw new Error("Ricekit standard-library import is missing");
  }
  const validationSource = transformed.replace(RICEKIT_IMPORT_RE, adapter);
  await less.render(
    validationSource,
    {
      globalVars: extractStylusVarDefaults(original),
      javascriptEnabled: false,
      math: "parens-division",
      strictImports: false,
    } as Parameters<typeof less.render>[1],
  );
}

async function reconcileDist(
  outDir: string,
  outputs: Map<string, string>,
): Promise<void> {
  await Deno.mkdir(outDir, { recursive: true });
  for await (const entry of Deno.readDir(outDir)) {
    if (entry.isFile && /\.user\.(?:css|less)$/.test(entry.name)) {
      await Deno.remove(join(outDir, entry.name));
    }
  }
  for (
    const [name, content] of [...outputs].sort(([a], [b]) => a.localeCompare(b))
  ) {
    await Deno.writeTextFile(join(outDir, name), content);
  }
}

async function collectUpstreamStyles(
  stylesDir: string,
): Promise<UpstreamEntry[]> {
  const entries: UpstreamEntry[] = [];
  try {
    for await (const entry of Deno.readDir(stylesDir)) {
      if (!entry.isDirectory) continue;
      const path = join(stylesDir, entry.name, "catppuccin.user.less");
      if (await exists(path)) entries.push({ site: entry.name, path });
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.warn(
        `warning: ${stylesDir} is missing; run git submodule update --init userstyles/upstream/catppuccin`,
      );
      return entries;
    }
    throw error;
  }
  return entries.sort((a, b) => a.site.localeCompare(b.site));
}

async function collectNativeStyles(
  stylesDir: string,
): Promise<NativeStyleInput[]> {
  const entries: NativeStyleInput[] = [];
  try {
    for await (const entry of Deno.readDir(stylesDir)) {
      if (!entry.isDirectory) continue;
      const dir = join(stylesDir, entry.name);
      const manifestPath = join(dir, "ricekit.toml");
      const cssPath = join(dir, "ricekit.css");
      if (!(await exists(manifestPath)) || !(await exists(cssPath))) continue;
      const manifest = parse(await Deno.readTextFile(manifestPath)) as Record<
        string,
        unknown
      >;
      entries.push({
        slug: entry.name,
        name: stringField(manifest, "name", manifestPath),
        description: stringField(manifest, "description", manifestPath),
        author: stringField(manifest, "author", manifestPath),
        domains: stringArrayField(manifest, "domains", manifestPath),
        desktopTargets: stringArrayField(
          manifest,
          "desktop_targets",
          manifestPath,
        ),
        css: await Deno.readTextFile(cssPath),
      });
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return entries;
    throw error;
  }
  return entries.sort((a, b) => a.slug.localeCompare(b.slug));
}

function extractStylusVarDefaults(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const metaStart = source.indexOf("==UserStyle==");
  const metaEnd = source.indexOf("==/UserStyle==");
  if (metaStart === -1 || metaEnd === -1) return out;
  const meta = source.slice(metaStart, metaEnd);
  const lineRe = /@var\s+(\w+)\s+([\w-]+)\s+"[^"]*"\s+(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(meta)) !== null) {
    const [, type, name, raw] = match;
    const rest = raw.trim();
    if (type === "select" || type === "dropdown") {
      const list = rest.match(/\[([^\]]+)\]/)?.[1] ?? "";
      const choices = [...list.matchAll(/"([^"]+)"/g)].map((choice) =>
        choice[1]
      );
      const selected = choices.find((choice) => /\*(:[^:]*)?$/.test(choice)) ??
        choices[0];
      if (selected !== undefined) {
        out[name] = selected.replace(/:.*$/, "").replace(/\*$/, "");
      }
    } else if (type === "checkbox") {
      out[name] = rest === "1" ? "1" : "0";
    } else if (type === "number" || type === "range") {
      const number = rest.match(/-?\d+(?:\.\d+)?/)?.[0];
      if (number !== undefined) out[name] = number;
    } else if (type === "color") {
      const color = rest.match(/#[0-9a-fA-F]{3,8}/)?.[0];
      if (color !== undefined) out[name] = color;
    } else if (type === "text") {
      const text = rest.match(/"([^"]*)"/)?.[1];
      if (text !== undefined) out[name] = text;
    }
  }
  return out;
}

function stringField(
  source: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path}: ${key} must be a non-empty string`);
  }
  return value;
}

function stringArrayField(
  source: Record<string, unknown>,
  key: string,
  path: string,
): string[] {
  const value = source[key];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new Error(`${path}: ${key} must be a string array`);
  }
  return value as string[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const line = (error as Error & { line?: number }).line;
  return line === undefined ? error.message : `line ${line}: ${error.message}`;
}

if (import.meta.main) {
  const result = await buildUserStyles();
  for (const failure of result.failures) {
    console.warn(
      `warning: excluded ${failure.site}: ${failure.error.split("\n")[0]}`,
    );
  }
  console.log(
    `=== build complete: ${result.upstreamOk}/${result.upstreamTotal} ok, ${result.failures.length} failed; ${result.nativeOk} native ===`,
  );
}
