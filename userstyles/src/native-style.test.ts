import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.8";
import { renderNativeUserStyle } from "./native-style.ts";

Deno.test("renderNativeUserStyle wraps shared CSS in UserCSS metadata", () => {
  const result = renderNativeUserStyle({
    slug: "linear",
    name: "Linear Ricekit",
    description: "Ricekit theme for Linear",
    author: "ricekit",
    domains: ["linear.app"],
    css: ":root { --linear-color-accent: var(--rk-accent); }",
    desktopTargets: ["../templates/linear-desktop/ricekit-app.css"],
  });

  assertStringIncludes(result.userCss, "@name Linear Ricekit");
  assertStringIncludes(result.userCss, "@namespace github.com/brs98/ricekit-community/userstyles");
  assertStringIncludes(result.userCss, '@-moz-document domain("linear.app")');
  assertStringIncludes(result.userCss, "--linear-color-accent: var(--rk-accent)");
  // desktopTargets pass through verbatim; real TOML uses "../templates/..."
  // because build.ts runs with cwd=userstyles/. The renderer is path-agnostic.
  assertEquals(result.desktopCopies, [
    {
      path: "../templates/linear-desktop/ricekit-app.css",
      css: ":root { --linear-color-accent: var(--rk-accent); }\n",
    },
  ]);
});

Deno.test("renderNativeUserStyle supports multiple domains", () => {
  const result = renderNativeUserStyle({
    slug: "slack",
    name: "Slack Ricekit",
    description: "Ricekit theme for Slack",
    author: "ricekit",
    domains: ["app.slack.com", "slack.com"],
    css: ".p-client { background: var(--rk-background); }",
    desktopTargets: ["../templates/slack-desktop/ricekit-app.css"],
  });

  assertStringIncludes(
    result.userCss,
    '@-moz-document domain("app.slack.com"), domain("slack.com")',
  );
});