import { chooseVersion } from "./stamp-meta.ts";

type DenoTest = { test(name: string, fn: () => void): void };
const deno = (globalThis as typeof globalThis & { Deno: DenoTest }).Deno;

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`assertEquals failed: expected ${expected}, got ${actual}`);
  }
}

const SOURCE = `/* ==UserStyle==
@name GitHub Catppuccin
@namespace github.com/catppuccin/userstyles/styles/github
@homepageURL https://github.com/catppuccin/userstyles/tree/main/styles/github
@version 2026.02.17
@updateURL https://github.com/catppuccin/userstyles/raw/main/styles/github/catppuccin.user.less
@supportURL https://github.com/catppuccin/userstyles/issues?q=is%3Aopen+is%3Aissue+label%3Agithub
@description Soothing pastel theme for GitHub
@author Catppuccin
@var select lightFlavor "Light Flavor" ["latte:Latte*", "frappe:Frappé"]
==/UserStyle== */
body { color: var(--rk-foreground); }
`;

const PREVIOUS = `/* ==UserStyle==
@name GitHub Ricekit
@namespace github.com/brs98/ricekit-community/userstyles
@homepageURL https://github.com/brs98/ricekit-community/tree/main/userstyles
@version 2026.02.17.202605211213
@updateURL https://raw.githubusercontent.com/brs98/ricekit-community/main/userstyles/build/dist/github.user.css
@supportURL https://github.com/brs98/ricekit-community/issues
@description Ricekit version of Catppuccin for GitHub
@author Catppuccin
==/UserStyle== */
body { color: var(--rk-foreground); }
`;

deno.test("chooseVersion preserves the committed version for unchanged output", () => {
  assertEquals(
    chooseVersion(SOURCE, PREVIOUS, "2026.02.17.209901010000"),
    "2026.02.17.202605211213",
  );
});

deno.test("chooseVersion uses the new version when compiled CSS changed", () => {
  const changed = SOURCE.replace("var(--rk-foreground)", "var(--rk-accent)");

  assertEquals(
    chooseVersion(changed, PREVIOUS, "2026.02.17.209901010000"),
    "2026.02.17.209901010000",
  );
});

deno.test("chooseVersion uses the new version when upstream metadata version changed", () => {
  const changed = SOURCE.replace("@version 2026.02.17", "@version 2026.02.18");

  assertEquals(
    chooseVersion(changed, PREVIOUS, "2026.02.18.209901010000"),
    "2026.02.18.209901010000",
  );
});
