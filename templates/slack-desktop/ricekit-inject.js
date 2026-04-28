;/* ricekit-electron-css-injection:BEGIN */(() => {
  const marker = "__ricekitElectronCssInjected";
  if (globalThis[marker]) return;
  globalThis[marker] = true;

  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { app } = require("electron");

  const appName = "slack";
  // Only the rk palette is injected as CSS — the userscript walks Slack's
  // styleSheets at runtime and emits palette-driven overrides into a single
  // <style id="ricekit-slack"> tag. Slack's emotion/styled-components class
  // names rotate on every production build, so a static `ricekit-app.css`
  // would go stale within a release; harvesting live is the only way to keep
  // coverage without churn.
  const varsPath = path.join(os.homedir(), ".config", "ricekit", "active", `${appName}-desktop`, "ricekit-vars.css");

  // The theme userscript source is spliced into the line below by `rkpatch
  // install`, replacing the bare identifier with a JSON-stringified string
  // literal. Keep the identifier confined to that single line — every literal
  // occurrence is replaced, and a stray match in a comment would inline the
  // entire userscript into that comment.
  const THEME_JS = __RICEKIT_THEME_JS__;

  // Track each webContents so we can re-inject CSS into all of them when
  // ricekit-vars.css changes on disk. WeakMap holds the inserted CSS key per
  // webContents so we can replace (rather than stack) on every reinjection.
  const tracked = new Set();
  const cssKeys = new WeakMap();

  function readCss() {
    try { return fs.readFileSync(varsPath, "utf8"); } catch { return ""; }
  }

  async function reinjectCss(wc) {
    if (!wc || wc.isDestroyed()) return;
    const css = readCss();
    if (!css) return;
    const oldKey = cssKeys.get(wc);
    if (oldKey) {
      try { await wc.removeInsertedCSS(oldKey); } catch {}
    }
    try {
      const key = await wc.insertCSS(css, { cssOrigin: "user" });
      cssKeys.set(wc, key);
    } catch {}
  }

  function injectTheme(target) {
    // `target` may be a WebFrameMain (from frame-created) or a webContents.
    if (!target || typeof target.executeJavaScript !== "function") return;
    target.executeJavaScript(THEME_JS).catch(() => {});
  }

  app.on("web-contents-created", (_event, wc) => {
    tracked.add(wc);
    wc.once("destroyed", () => {
      tracked.delete(wc);
      cssKeys.delete(wc);
    });

    // Run the userscript as early as possible — `frame-created` fires for the
    // initial about:blank document before any page scripts run, so the
    // userscript can install its singleton <style> tag and observers before
    // Slack's bundle adds its own stylesheets. `did-frame-navigate` re-runs
    // the script in the post-navigation document context (the first one
    // actually under https://app.slack.com), where Slack's stylesheets exist.
    //
    // Restrict to the top frame only. `frame.parent !== null` means a
    // subframe — Slack loads cross-origin iframes (OAuth, link previews)
    // that don't need our observers running inside them.
    wc.on("frame-created", (_e, { frame }) => {
      if (frame.parent !== null) return;
      injectTheme(frame);
    });
    wc.on("did-frame-navigate", (_e, _url, _code, _status, isMainFrame) => {
      if (isMainFrame) injectTheme(wc);
    });

    wc.on("dom-ready", () => { reinjectCss(wc); injectTheme(wc); });
    wc.on("did-finish-load", () => reinjectCss(wc));
  });

  // Hot-reload: watch the active vars.css and re-inject when ricekit rewrites
  // it after a theme change. The userscript's palette poll picks up the new
  // `--rk-*` values on its next tick (≤1s) and re-harvests, so the theme
  // change reflects without a quit/relaunch.
  try {
    fs.watchFile(varsPath, { interval: 500 }, (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs) return;
      for (const wc of tracked) reinjectCss(wc);
    });
  } catch {}
})();/* ricekit-electron-css-injection:END */
