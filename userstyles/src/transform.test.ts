import {
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "jsr:@std/assert@^1.0.9";
import { transformUserLess, UnsupportedUserStyleError } from "./transform.ts";
import less from "npm:less@4.2.1";

const HEADER = `/* ==UserStyle==
@name Example Catppuccin
@version 2026.08.13
@preprocessor less
@var select lightFlavor "Light Flavor" ["latte:Latte*"]
@var select darkFlavor "Dark Flavor" ["mocha:Mocha*"]
@var select accentColor "Accent" ["mauve:Mauve*"]
@var checkbox compact "Compact" 1
==/UserStyle== */`;

Deno.test("transformUserLess preserves upstream text outside localized edits", () => {
  const source = `${HEADER}

@import "https://userstyles.catppuccin.com/lib/std/v1.less";

// This comment and spacing must remain exact.
#catppuccin(@flavor) {
  #lib.palette();
  color: @text;
  background: fade(@base, 30%);
  filter: @accent-filter;
}
`;

  const result = transformUserLess(source);

  assertStringIncludes(
    result,
    '@import "https://raw.githubusercontent.com/brs98/ricekit-community/main/userstyles/lib/std/v1.less";',
  );
  assertStringIncludes(
    result,
    "// This comment and spacing must remain exact.",
  );
  assertStringIncludes(result, "  color: @text;");
  assertStringIncludes(
    result,
    '  background: ~"rgb(from var(--rk-background) r g b / 0.3)";',
  );
  assertEquals(result.includes("@var select lightFlavor"), false);
  assertEquals(result.includes("@var select darkFlavor"), false);
  assertEquals(result.includes("@var select accentColor"), false);
  assertStringIncludes(result, '@var checkbox compact "Compact" 1');
});

Deno.test("transformUserLess accepts the legacy standard-library alias", () => {
  const source = `${HEADER}
@import 'https://userstyles.catppuccin.com/lib/lib.less';
body { color: @text; }
`;
  assertMatch(
    transformUserLess(source),
    /@import 'https:\/\/raw\.githubusercontent\.com\/brs98\/ricekit-community\/main\/userstyles\/lib\/std\/v1\.less';/,
  );
});

Deno.test("transformUserLess rewrites direct rgbify calls to runtime RGB arguments", () => {
  const source = `${HEADER}
@import "https://userstyles.catppuccin.com/lib/std/v1.less";
#catppuccin(@flavor) {
  #lib.palette();
  --site-base-rgb: #lib.rgbify(@base)[];
  color: rgba(#lib.rgbify(@red)[], 40%);
}
`;
  const result = transformUserLess(source);
  assertStringIncludes(result, '--site-base-rgb: ~"var(--rk-base-rgb)";');
  assertStringIncludes(
    result,
    'color: ~"rgb(from var(--rk-red) r g b / 0.4)";',
  );
});

Deno.test("transformUserLess resolves local palette aliases inside color math", () => {
  const source = `${HEADER}
@import "https://userstyles.catppuccin.com/lib/std/v1.less";
#catppuccin(@flavor) {
  #lib.palette();
  @button: @accent;
  @button-hover: @button;
  color: darken(@button-hover, 5%);
}
`;
  const result = transformUserLess(source);
  assertStringIncludes(result, "@button: @accent;");
  assertStringIncludes(result, "@button-hover: @button;");
  assertStringIncludes(
    result,
    'color: ~"hsl(from var(--rk-accent) h s calc(l - 5))";',
  );
});

Deno.test("transformUserLess rewrites dynamic LESS variable definitions", () => {
  const source = `${HEADER}
@import "https://userstyles.catppuccin.com/lib/std/v1.less";
#catppuccin(@flavor) {
  #lib.palette();
  @violet: darken(@mauve, 20%);
  background: fade(@violet, 40%);
}
`;
  const result = transformUserLess(source);
  assertStringIncludes(
    result,
    '@violet: ~"hsl(from var(--rk-accent) h s calc(l - 20))";',
  );
  assertStringIncludes(
    result,
    'background: ~"rgb(from hsl(from var(--rk-accent) h s calc(l - 20)) r g b / 0.4)";',
  );
});

Deno.test("transformUserLess rewrites compound stdlib channel helpers", () => {
  const source = `${HEADER}
@import "https://userstyles.catppuccin.com/lib/std/v1.less";
#catppuccin(@flavor) {
  #lib.palette();
  --rgb: #lib.rgbify(darken(@surface0, 5%))[];
  --hsl: #hslify(lighten(@accent, 5%))[];
  --conditional: #lib.rgbify(if(@flavor = latte, @crust, @text))[];
  --channels: hue(@base) saturation(@base) lightness(@base);
}
`;
  const result = transformUserLess(source);
  assertStringIncludes(
    result,
    '--rgb: ~"from hsl(from var(--rk-surface0) h s calc(l - 5)) r g b";',
  );
  assertStringIncludes(
    result,
    '--hsl: ~"from hsl(from var(--rk-accent) h s calc(l + 5)) h s l";',
  );
  assertStringIncludes(
    result,
    '--conditional: ~"from light-dark(var(--rk-crust), var(--rk-foreground)) r g b";',
  );
  assertStringIncludes(
    result,
    '--channels: ~"from var(--rk-background) h s l";',
  );
});

Deno.test("transformUserLess preserves filter variables for the runtime adapter", () => {
  const source = `${HEADER}
@import "https://userstyles.catppuccin.com/lib/std/v1.less";
#catppuccin(@flavor) { #lib.palette(); filter: @accent-filter; }
`;
  assertStringIncludes(transformUserLess(source), "filter: @accent-filter");
});

Deno.test("transformUserLess uses static compatibility values for numeric-only LESS operations", () => {
  const source = `${HEADER}
@import "https://userstyles.catppuccin.com/lib/std/v1.less";
#catppuccin(@flavor) {
  #lib.palette();
  color: multiply(@blue, #555);
  background: overlay(@surface0, @yellow);
  #hslbreakdown(@accent, primary);
  --hue: hue(@accent);
  --saturation: saturation(@accent);
  --lightness: lightness(@surface1);
}
`;
  const result = transformUserLess(source);
  assertStringIncludes(result, "color: #2e3c53;");
  assertMatch(result, /background: #[0-9a-f]{6};/);
  assertStringIncludes(result, "#hslbreakdown( #cba6f7, primary)");
  assertMatch(result, /--hue: 267(?:\.\d+)?;/);
  assertMatch(result, /--saturation: 83(?:\.\d+)?%;/);
  assertMatch(result, /--lightness: 31(?:\.\d+)?%;/);
});

Deno.test("transformUserLess rewrites color math in interpolated custom properties", () => {
  const source = `${HEADER}
@import "https://userstyles.catppuccin.com/lib/std/v1.less";
#catppuccin(@flavor) {
  #lib.palette();
  each(@colors, { --group-@{index}: darken(@value, 10%); });
}
`;
  assertStringIncludes(
    transformUserLess(source),
    `--group-@{index}: ~"hsl(from @{value} h s calc(l - 10))";`,
  );
});

Deno.test("transformUserLess rewrites space-separated RGB channels", () => {
  const source = `${HEADER}
@import "https://userstyles.catppuccin.com/lib/std/v1.less";
#catppuccin(@flavor) {
  #lib.palette();
  --channels: red(@accent) green(@accent) blue(@accent);
}
`;
  assertStringIncludes(
    transformUserLess(source),
    `--channels: ~"from var(--rk-accent) r g b";`,
  );
});

Deno.test("transformUserLess rejects unknown standard-library versions", () => {
  const source = `${HEADER}
@import "https://userstyles.catppuccin.com/lib/std/v2.less";
body { color: @text; }
`;
  try {
    transformUserLess(source);
    throw new Error("expected rejection");
  } catch (error) {
    assertEquals(error instanceof UnsupportedUserStyleError, true);
    assertMatch((error as Error).message, /std\/v2\.less/);
  }
});

Deno.test("transformed LESS compiles against the local Ricekit v1 adapter", async () => {
  const adapter = await Deno.readTextFile("lib/std/v1.less");
  const source = `${HEADER}
@import "https://userstyles.catppuccin.com/lib/std/v1.less";
body {
  #catppuccin(@darkFlavor);
}
#catppuccin(@flavor) {
  #lib.palette();
  #lib.defaults();
  #lib.css-variables();
  color: @text;
  background: fade(@base, 30%);
  filter: @accent-filter;
}
`;
  const transformed = transformUserLess(source).replace(
    /@import ["']https:\/\/raw\.githubusercontent\.com[^;]+;/,
    adapter,
  );
  const result = await less.render(transformed, { javascriptEnabled: false });
  assertStringIncludes(result.css, "color: var(--rk-foreground)");
  assertStringIncludes(result.css, "--ctp-base: var(--rk-background)");
  assertStringIncludes(result.css, "filter: var(--rk-accent-filter)");
  assertStringIncludes(
    (await less.render(`${adapter}\na { color: @catppuccin[@mocha][@text]; }`))
      .css,
    "color: var(--rk-foreground)",
  );
  assertStringIncludes(
    (await less.render(
      `${adapter}\na { filter: @catppuccin-filters[@mocha][@text]; }`,
    )).css,
    "filter: var(--rk-text-filter)",
  );
  assertStringIncludes(
    result.css,
    "rgb(from var(--rk-background) r g b / 0.3)",
  );
  assertEquals(result.css.includes("#1e1e2e"), false);
});

Deno.test("runtime template exposes RGB arguments for resolved and derived tokens", async () => {
  const template = await Deno.readTextFile(
    "../templates/userstyles/templates/rk-vars.css",
  );
  assertStringIncludes(
    template,
    "--rk-base-rgb: {{r(background)}}, {{g(background)}}, {{b(background)}};",
  );
  assertStringIncludes(
    template,
    "--rk-surface0-rgb: from var(--rk-surface0) r g b;",
  );
  assertStringIncludes(
    template,
    "--rk-lavender-rgb: from var(--rk-lavender) r g b;",
  );
});

Deno.test("runtime template exposes SVG filters rendered from theme channels", async () => {
  const template = await Deno.readTextFile(
    "../templates/userstyles/templates/rk-vars.css",
  );
  assertStringIncludes(template, "--rk-red-filter: url(");
  assertStringIncludes(
    template,
    "flood-color='rgb({{r(red)}} {{g(red)}} {{b(red)}})'",
  );
  assertStringIncludes(template, "in2='SourceAlpha'");
});
