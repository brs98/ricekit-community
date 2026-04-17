import { assertEquals } from "jsr:@std/assert@^1.0.9";
import { rewriteValue } from "./rewrite-less.ts";

Deno.test("bare palette var becomes CSS var reference", () => {
  // @text maps to --rk-foreground via PALETTE_MAP's semantic-direct row.
  assertEquals(rewriteValue("@text"), "var(--rk-foreground)");
  assertEquals(rewriteValue("@accent"), "var(--rk-accent)");
});

Deno.test("style-guide ANSI mappings (10 tokens)", () => {
  // These follow the Catppuccin style guide's ANSI color mapping directly.
  assertEquals(rewriteValue("@red"), "var(--rk-red)");
  assertEquals(rewriteValue("@green"), "var(--rk-green)");
  assertEquals(rewriteValue("@yellow"), "var(--rk-yellow)");
  assertEquals(rewriteValue("@blue"), "var(--rk-blue)");
  assertEquals(rewriteValue("@pink"), "var(--rk-magenta)");
  assertEquals(rewriteValue("@teal"), "var(--rk-cyan)");
  assertEquals(rewriteValue("@subtext0"), "var(--rk-white)");
  assertEquals(rewriteValue("@subtext1"), "var(--rk-bright-white)");
  assertEquals(rewriteValue("@surface1"), "var(--rk-black)");
  assertEquals(rewriteValue("@surface2"), "var(--rk-bright-black)");
});

Deno.test("oklch-derived tokens point at host-emitted --rk-* slots", () => {
  // Non-ANSI Catppuccin tokens are materialized by host.ts as oklch()
  // relative-color expressions on :root; the rewriter just emits a var() ref.
  assertEquals(rewriteValue("@surface0"), "var(--rk-surface0)");
  assertEquals(rewriteValue("@mantle"), "var(--rk-mantle)");
  assertEquals(rewriteValue("@peach"), "var(--rk-peach)");
  assertEquals(rewriteValue("@lavender"), "var(--rk-lavender)");
  assertEquals(rewriteValue("@rosewater"), "var(--rk-rosewater)");
});

Deno.test("@mauve follows ricekit's accent (theme-chooses)", () => {
  assertEquals(rewriteValue("@mauve"), "var(--rk-accent)");
});

Deno.test("fade() on palette var becomes rgb(from … alpha)", () => {
  assertEquals(
    rewriteValue("fade(@accent, 30%)"),
    `~"rgb(from var(--rk-accent) r g b / 0.3)"`,
  );
  assertEquals(
    rewriteValue("fade(@base, 60%)"),
    `~"rgb(from var(--rk-background) r g b / 0.6)"`,
  );
});

Deno.test("lighten()/darken() use hsl relative lightness with bare numbers", () => {
  // `l` resolves to a <number> in relative-color form, so we add a bare
  // number — mixing `l + 10%` in calc() is type-ambiguous and some Firefox
  // versions silently drop the whole declaration.
  assertEquals(
    rewriteValue("lighten(@surface0, 10%)"),
    `~"hsl(from var(--rk-surface0) h s calc(l + 10))"`,
  );
  assertEquals(
    rewriteValue("darken(@blue, 5%)"),
    `~"hsl(from var(--rk-blue) h s calc(l - 5))"`,
  );
});

Deno.test("saturate()/desaturate() use hsl relative saturation with bare numbers", () => {
  assertEquals(
    rewriteValue("saturate(@red, 20%)"),
    `~"hsl(from var(--rk-red) h calc(s + 20) l)"`,
  );
});

Deno.test("mix() becomes color-mix with weight", () => {
  assertEquals(
    rewriteValue("mix(@red, @blue, 50%)"),
    `~"color-mix(in srgb, var(--rk-red) 50%, var(--rk-blue))"`,
  );
});

Deno.test("2-arg mix() defaults weight to 50%", () => {
  // LESS mix(a, b) without explicit weight uses 50/50 — matches CSS color-mix
  // default when we supply `50%` explicitly.
  assertEquals(
    rewriteValue("mix(@red, @yellow)"),
    `~"color-mix(in srgb, var(--rk-red) 50%, var(--rk-yellow))"`,
  );
});

Deno.test("nested color ops compose via a single flat relative-color expr", () => {
  // Nested ops produce one flat `~"..."` wrap so LESS doesn't see nested
  // double-quoted strings (which it can't parse).
  assertEquals(
    rewriteValue("lighten(fade(@base, 50%), 10%)"),
    `~"hsl(from rgb(from var(--rk-background) r g b / 0.5) h s calc(l + 10))"`,
  );
});

Deno.test("unrelated declarations pass through unchanged", () => {
  assertEquals(rewriteValue("1px solid #abc"), "1px solid #abc");
  assertEquals(
    rewriteValue("rgba(27, 31, 35, 0.04)"),
    "rgba(27, 31, 35, 0.04)",
  );
  assertEquals(rewriteValue("var(--x, var(--y))"), "var(--x, var(--y))");
});

Deno.test("mixed declaration with multiple values", () => {
  assertEquals(
    rewriteValue("1px solid fade(@accent, 40%)"),
    `1px solid ~"rgb(from var(--rk-accent) r g b / 0.4)"`,
  );
});

Deno.test("spin() uses bare-number degrees", () => {
  // `h` is a <number> of degrees in relative-color form, so don't add a
  // `deg` unit to the second arg — mixing number + angle is the same type
  // mismatch that breaks lightness/saturation calcs.
  assertEquals(
    rewriteValue("spin(@accent, 180)"),
    `~"hsl(from var(--rk-accent) calc(h + 180) s l)"`,
  );
});

Deno.test("filter-suffix palette vars pass through (not colors)", () => {
  // @rosewater-filter is an SVG filter string, not a color.
  assertEquals(rewriteValue("@rosewater-filter"), "@rosewater-filter");
});

Deno.test("non-palette LESS variables pass through", () => {
  assertEquals(rewriteValue("@flavor"), "@flavor");
  assertEquals(rewriteValue("@accentColor"), "@accentColor");
});

Deno.test("palette vars inside non-color functions are left alone", () => {
  // #lib.rgbify(@mantle)[] decomposes to numeric r,g,b — must keep @mantle
  // as a LESS variable so the mixin can read the real hex value.
  assertEquals(
    rewriteValue("rgba(#lib.rgbify(@mantle)[], 1)"),
    "rgba(#lib.rgbify(@mantle)[], 1)",
  );
});

Deno.test("color op inside an unknown function is NOT rewritten", () => {
  // #hslify(lighten(@accent, 5%)) — the LESS-level hslify mixin must see a
  // real hex color, so the inner lighten() must be left for LESS to evaluate.
  assertEquals(
    rewriteValue("#hslify(lighten(@accent, 5%))"),
    "#hslify(lighten(@accent, 5%))",
  );
});

Deno.test("if(@flavor=...) inside known op resolves to mocha branch", () => {
  // ichi.moe: `fade(if(@flavor = "latte", @surface0, @surface1), 50%)`.
  // Our @flavor is always "mocha", so the conditional picks @surface1,
  // which maps to --rk-black via the style-guide ANSI row.
  assertEquals(
    rewriteValue(`fade(if(@flavor = "latte", @surface0, @surface1), 50%)`),
    `~"rgb(from var(--rk-black) r g b / 0.5)"`,
  );
});

Deno.test("if(@flavor=mocha, ...) picks first branch", () => {
  assertEquals(
    rewriteValue(`fade(if(@flavor = "mocha", @surface0, @surface1), 50%)`),
    `~"rgb(from var(--rk-surface0) r g b / 0.5)"`,
  );
});

Deno.test("if(@flavor=...) with unquoted flavor literal resolves too", () => {
  // twitter-style: `if(@flavor = latte, A, B)` — no quotes around literal.
  assertEquals(
    rewriteValue(`fade(if(@flavor = latte, @red, @blue), 30%)`),
    `~"rgb(from var(--rk-blue) r g b / 0.3)"`,
  );
});

Deno.test("top-level if(@flavor=...) also resolves (equivalent to LESS eval)", () => {
  // Pre-resolving at any level produces the same result LESS would reach at
  // compile time since @flavor is statically "mocha" in our pipeline. Top-
  // level resolution bypasses LESS, which is fine because LESS would have
  // picked the same branch.
  assertEquals(
    rewriteValue(`if(@flavor = "latte", #fff, @crust)`),
    `var(--rk-crust)`,
  );
});
