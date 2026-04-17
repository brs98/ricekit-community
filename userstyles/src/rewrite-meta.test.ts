import { assertEquals, assertMatch } from "jsr:@std/assert@^1";
import { rewriteMeta } from "./rewrite-meta.ts";

const SAMPLE_WITH_BOTH = `/* ==UserStyle==
@name GitHub Catppuccin
@namespace github.com/catppuccin/userstyles/styles/github
@homepageURL https://github.com/catppuccin/userstyles/tree/main/styles/github
@supportURL https://github.com/catppuccin/userstyles/issues?q=is%3Aopen+is%3Aissue+label%3Agithub
@version 2026.02.17
@updateURL https://github.com/catppuccin/userstyles/raw/main/styles/github/catppuccin.user.less
@description Soothing pastel theme for GitHub
@author Catppuccin
@var select lightFlavor "Light Flavor" ["latte:Latte*", "frappe:Frappé"]
@var select darkFlavor "Dark Flavor" ["latte:Latte", "mocha:Mocha*"]
@var select accentColor "Accent" ["mauve:Mauve*", "red:Red"]
@var color myColor "My Color" #cba6f7
==/UserStyle== */
body { color: red; }
`;

const SAMPLE_WITHOUT_META = `/* ==UserStyle==
@name Ricekit Native Example
@description Drop-in custom userstyle
==/UserStyle== */
body { color: blue; }
`;

const NEW_URL = "https://raw.githubusercontent.com/brs98/ricekit-community/main/userstyles/build/dist/github.user.css";
const NEW_VERSION = "2026.02.17.202604171430";

Deno.test("replaces @updateURL when present", () => {
  const out = rewriteMeta(SAMPLE_WITH_BOTH, { updateUrl: NEW_URL, version: NEW_VERSION });
  assertMatch(out, new RegExp(`@updateURL ${NEW_URL.replace(/[.\/]/g, "\\$&")}`));
  // Upstream URL must be gone.
  assertEquals(out.includes("catppuccin/userstyles/raw/main"), false);
});

Deno.test("replaces @version when present", () => {
  const out = rewriteMeta(SAMPLE_WITH_BOTH, { updateUrl: NEW_URL, version: NEW_VERSION });
  assertMatch(out, new RegExp(`@version ${NEW_VERSION.replace(/\./g, "\\.")}`));
  assertEquals(out.includes("@version 2026.02.17\n"), false);
});

Deno.test("inserts @updateURL and @version when missing", () => {
  const out = rewriteMeta(SAMPLE_WITHOUT_META, { updateUrl: NEW_URL, version: NEW_VERSION });
  assertMatch(out, new RegExp(`@updateURL ${NEW_URL.replace(/[.\/]/g, "\\$&")}`));
  assertMatch(out, new RegExp(`@version ${NEW_VERSION.replace(/\./g, "\\.")}`));
  // Inserted before the close marker.
  const updateUrlIdx = out.indexOf("@updateURL");
  const closeIdx = out.indexOf("==/UserStyle==");
  assertEquals(updateUrlIdx < closeIdx && updateUrlIdx > 0, true);
});

Deno.test("preserves body content unchanged", () => {
  const out = rewriteMeta(SAMPLE_WITH_BOTH, { updateUrl: NEW_URL, version: NEW_VERSION });
  assertEquals(out.endsWith("body { color: red; }\n"), true);
});

Deno.test("is idempotent when given the same inputs twice", () => {
  const once = rewriteMeta(SAMPLE_WITH_BOTH, { updateUrl: NEW_URL, version: NEW_VERSION });
  const twice = rewriteMeta(once, { updateUrl: NEW_URL, version: NEW_VERSION });
  assertEquals(once, twice);
});

Deno.test("throws when no ==UserStyle== block exists", () => {
  let threw = false;
  try {
    rewriteMeta("/* plain css */\nbody {}\n", { updateUrl: NEW_URL, version: NEW_VERSION });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("replaces @name when provided", () => {
  const out = rewriteMeta(SAMPLE_WITH_BOTH, {
    updateUrl: NEW_URL,
    version: NEW_VERSION,
    name: "GitHub Ricekit",
  });
  assertMatch(out, /@name GitHub Ricekit\b/);
  assertEquals(out.includes("@name GitHub Catppuccin\n"), false);
});

Deno.test("replaces @namespace when provided", () => {
  const out = rewriteMeta(SAMPLE_WITH_BOTH, {
    updateUrl: NEW_URL,
    version: NEW_VERSION,
    namespace: "github.com/brs98/ricekit-community/userstyles",
  });
  assertMatch(out, /@namespace github\.com\/brs98\/ricekit-community\/userstyles\b/);
  assertEquals(out.includes("catppuccin/userstyles/styles/github"), false);
});

Deno.test("replaces @homepageURL and @supportURL when provided", () => {
  const out = rewriteMeta(SAMPLE_WITH_BOTH, {
    updateUrl: NEW_URL,
    version: NEW_VERSION,
    homepageURL: "https://github.com/brs98/ricekit-community/tree/main/userstyles",
    supportURL: "https://github.com/brs98/ricekit-community/issues",
  });
  assertMatch(out, /@homepageURL https:\/\/github\.com\/brs98\/ricekit-community\/tree\/main\/userstyles\b/);
  assertMatch(out, /@supportURL https:\/\/github\.com\/brs98\/ricekit-community\/issues\b/);
  // No filter/label query carried over.
  assertEquals(out.includes("label%3Agithub"), false);
});

Deno.test("replaces @description when provided", () => {
  const out = rewriteMeta(SAMPLE_WITH_BOTH, {
    updateUrl: NEW_URL,
    version: NEW_VERSION,
    description: "Ricekit version of Catppuccin for GitHub",
  });
  assertMatch(out, /@description Ricekit version of Catppuccin for GitHub\b/);
  assertEquals(out.includes("Soothing pastel theme"), false);
});

Deno.test("strips @var select and @var dropdown lines when stripVarSelects", () => {
  const out = rewriteMeta(SAMPLE_WITH_BOTH, {
    updateUrl: NEW_URL,
    version: NEW_VERSION,
    stripVarSelects: true,
  });
  assertEquals(out.includes("@var select lightFlavor"), false);
  assertEquals(out.includes("@var select darkFlavor"), false);
  assertEquals(out.includes("@var select accentColor"), false);
  // Other @var types survive.
  assertMatch(out, /@var color myColor/);
});

Deno.test("leaves @var select alone when stripVarSelects is false/absent", () => {
  const out = rewriteMeta(SAMPLE_WITH_BOTH, {
    updateUrl: NEW_URL,
    version: NEW_VERSION,
  });
  assertMatch(out, /@var select lightFlavor/);
  assertMatch(out, /@var select darkFlavor/);
  assertMatch(out, /@var select accentColor/);
});

Deno.test("inserts @name/@namespace/@homepageURL/@supportURL/@description when missing", () => {
  const out = rewriteMeta(SAMPLE_WITHOUT_META, {
    updateUrl: NEW_URL,
    version: NEW_VERSION,
    name: "Example Ricekit",
    namespace: "github.com/brs98/ricekit-community/userstyles",
    homepageURL: "https://github.com/brs98/ricekit-community/tree/main/userstyles",
    supportURL: "https://github.com/brs98/ricekit-community/issues",
    description: "Ricekit version of Catppuccin for Example",
  });
  // All inserted before ==/UserStyle==.
  const closeIdx = out.indexOf("==/UserStyle==");
  for (const needle of [
    "@name Example Ricekit",
    "@namespace github.com/brs98/ricekit-community/userstyles",
    "@homepageURL https://github.com/brs98/ricekit-community/tree/main/userstyles",
    "@supportURL https://github.com/brs98/ricekit-community/issues",
    "@description Ricekit version of Catppuccin for Example",
  ]) {
    const idx = out.indexOf(needle);
    assertEquals(idx > 0 && idx < closeIdx, true, `missing or misplaced: ${needle}`);
  }
  // Original @name line replaced, not duplicated.
  assertEquals(out.match(/@name\s+/g)?.length, 1);
  assertEquals(out.includes("@name Ricekit Native Example"), false);
});

Deno.test("idempotent with all optional fields", () => {
  const opts = {
    updateUrl: NEW_URL,
    version: NEW_VERSION,
    name: "GitHub Ricekit",
    namespace: "github.com/brs98/ricekit-community/userstyles",
    homepageURL: "https://github.com/brs98/ricekit-community/tree/main/userstyles",
    supportURL: "https://github.com/brs98/ricekit-community/issues",
    description: "Ricekit version of Catppuccin for GitHub",
    stripVarSelects: true,
  } as const;
  const once = rewriteMeta(SAMPLE_WITH_BOTH, opts);
  const twice = rewriteMeta(once, opts);
  assertEquals(once, twice);
});
