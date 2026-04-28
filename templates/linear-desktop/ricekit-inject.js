;/* ricekit-electron-css-injection:BEGIN */(() => {
  const marker = "__ricekitElectronCssInjected";
  if (globalThis[marker]) return;
  globalThis[marker] = true;

  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { app, webContents: webContentsApi } = require("electron");

  const appName = "linear";
  // Only the rk palette is injected as CSS — the userscript reads `--rk-*` off
  // `:root` and applies the theme via Linear's native custom-theme store. There
  // is no fallback `ricekit-app.css`: trying to override Linear's styles
  // directly fights the native theme system and causes more breakage than it
  // fixes.
  const varsPath = path.join(os.homedir(), ".config", "ricekit", "active", `${appName}-desktop`, "ricekit-vars.css");

  function readCss() {
    try { return fs.readFileSync(varsPath, "utf8"); } catch { return ""; }
  }

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

    // Run the sentinel as early as possible — `frame-created` fires for the
    // initial about:blank document before any page scripts run, giving the
    // Object.prototype sentinel a chance to install itself ahead of Linear's
    // module bundle. `did-frame-navigate` then re-runs the script in the
    // post-navigation document context (the first one that's actually
    // https://linear.app), where the bundle constructs UserSettings.
    //
    // Restrict to the top frame only. `frame.parent !== null` means a
    // subframe — typically a third-party iframe (auth callbacks, embeds)
    // we don't want to perturb with the Object.prototype sentinel.
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
  // it after a theme change. This makes Linear pick up the new palette without
  // a full quit/relaunch — the userscript's polling loop reads the new
  // `--rk-*` values on its next tick and pushes the updated theme to Linear's
  // MobX store.
  try {
    fs.watchFile(varsPath, { interval: 500 }, (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs) return;
      for (const wc of tracked) reinjectCss(wc);
    });
  } catch {}
})();/* ricekit-electron-css-injection:END */
