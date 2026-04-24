;/* ricekit-electron-css-injection:BEGIN */(() => {
  const marker = "__ricekitElectronCssInjected";
  if (globalThis[marker]) return;
  globalThis[marker] = true;

  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { app } = require("electron");

  const appName = "slack";
  const varsPath = path.join(os.homedir(), ".config", "ricekit", "active", `${appName}-desktop`, "ricekit-vars.css");
  const appCssPath = path.join(os.homedir(), ".config", "ricekit", "custom-configs", `${appName}-desktop`, "ricekit-app.css");

  function readCss() {
    return [varsPath, appCssPath]
      .map((file) => {
        try {
          return fs.readFileSync(file, "utf8");
        } catch {
          return "";
        }
      })
      .filter(Boolean)
      .join("\n");
  }

  function inject(webContents) {
    if (webContents.isDestroyed()) return;
    const css = readCss();
    if (!css) return;
    webContents.insertCSS(css, { cssOrigin: "user" }).catch(() => {});
  }

  app.on("web-contents-created", (_event, webContents) => {
    webContents.on("dom-ready", () => inject(webContents));
    webContents.on("did-finish-load", () => inject(webContents));
  });
})();/* ricekit-electron-css-injection:END */
