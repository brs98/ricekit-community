import { assertEquals, assertMatch } from "jsr:@std/assert@^1";
import { rewriteMeta } from "./rewrite-meta.ts";

const SAMPLE_WITH_BOTH = `/* ==UserStyle==
@name GitHub Catppuccin
@version 2026.02.17
@updateURL https://github.com/catppuccin/userstyles/raw/main/styles/github/catppuccin.user.less
@description Soothing pastel theme for GitHub
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
