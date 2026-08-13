import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.9";
import { join } from "jsr:@std/path@^1.0.8";
import { buildUserStyles } from "./build.ts";

const META = `/* ==UserStyle==
@name Example Catppuccin
@version 2026.08.13
@preprocessor less
@var select lightFlavor "Light" ["latte:Latte*"]
@var select darkFlavor "Dark" ["mocha:Mocha*"]
@var select accentColor "Accent" ["mauve:Mauve*"]
==/UserStyle== */`;

Deno.test("buildUserStyles reconciles output around per-style rejection", async () => {
  const root = await Deno.makeTempDir();
  try {
    const upstream = join(root, "upstream");
    const native = join(root, "native");
    const out = join(root, "dist");
    await Deno.mkdir(join(upstream, "good"), { recursive: true });
    await Deno.mkdir(join(upstream, "bad"), { recursive: true });
    await Deno.mkdir(native, { recursive: true });
    await Deno.mkdir(out, { recursive: true });
    await Deno.writeTextFile(join(out, "stale.user.less"), "stale");
    await Deno.writeTextFile(
      join(upstream, "good", "catppuccin.user.less"),
      `${META}\n@import "https://userstyles.catppuccin.com/lib/std/v1.less";\nbody { #catppuccin(@darkFlavor); }\n#catppuccin(@flavor) { #lib.palette(); color: @text; }\n`,
    );
    await Deno.writeTextFile(
      join(upstream, "bad", "catppuccin.user.less"),
      `${META}\n@import "https://userstyles.catppuccin.com/lib/std/v1.less";\n#catppuccin(@flavor) { #lib.palette(); filter: @accent-filter; }\n`,
    );

    const result = await buildUserStyles({
      upstreamStylesDir: upstream,
      nativeStylesDir: native,
      outDir: out,
      adapterPath: "lib/std/v1.less",
    });

    assertEquals(result.upstreamTotal, 2);
    assertEquals(result.upstreamOk, 2);
    assertEquals(result.failures.length, 0);
    assertEquals(await exists(join(out, "good.user.less")), true);
    assertEquals(await exists(join(out, "bad.user.less")), true);
    assertEquals(await exists(join(out, "stale.user.less")), false);
    assertStringIncludes(
      await Deno.readTextFile(join(out, "good.user.less")),
      "@preprocessor less",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
