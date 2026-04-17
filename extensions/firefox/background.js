// Ricekit — live browser + web-page theming via native messaging.
//
// Single native host (`ricekit`, registered by ricekit main) emits one generic
// message per rendered file under ~/.config/ricekit/active/:
//
//   file_update { config, fileName, fileUri, content }
//     → routed by `config` name in handleFileUpdate():
//         config === "userstyles"  → browser.sheet.loadGlobal(fileUri)
//         config === "firefox"     → browser.theme.update(JSON.parse(content).colors)
//         config === "zen-colors"  → browser.stylesheet.reload(fileUri)
//
// One port, one reconnect loop.

"use strict";

const HOST_NAME = "ricekit";
const RECONNECT_MS = 5000;

let reconnectTimer = null;

function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    console.log(`[${HOST_NAME}] connecting to native host...`);
    const port = browser.runtime.connectNative(HOST_NAME);

    port.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "file_update") {
        handleFileUpdate(msg);
      }
    });

    port.onDisconnect.addListener(() => {
      const err = browser.runtime.lastError;
      console.log(`[${HOST_NAME}] disconnected:`, err ? err.message : "clean");
      reconnectTimer = setTimeout(connect, RECONNECT_MS);
    });
  } catch (e) {
    console.error(`[${HOST_NAME}] connection error:`, e);
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
  }
}

function handleFileUpdate(msg) {
  if (msg.config === "userstyles" && msg.fileUri) {
    loadGlobalSheet(msg.fileUri);
  } else if (msg.config === "firefox" && msg.content) {
    applyFirefoxTheme(msg.content);
  } else if (msg.config === "zen-colors" && msg.fileUri) {
    reloadChromeSheet(msg.fileUri);
  }
}

function applyFirefoxTheme(colorsJson) {
  let colors;
  try {
    colors = JSON.parse(colorsJson).colors;
  } catch (e) {
    console.error(`[${HOST_NAME}] Firefox theme colors parse failed:`, e);
    return;
  }
  if (!colors) return;
  browser.theme.update({ colors }).then(
    () => console.log(`[${HOST_NAME}] Firefox theme applied`),
    (err) => console.error(`[${HOST_NAME}] Firefox theme failed:`, err),
  );
}

async function reloadChromeSheet(fileUri) {
  try {
    const result = await browser.stylesheet.reload(fileUri);
    console.log(
      `[${HOST_NAME}] chrome stylesheet reloaded (${result.windows} window(s), ${result.elapsed}ms)`,
    );
  } catch (e) {
    console.error(`[${HOST_NAME}] chrome stylesheet reload failed:`, e);
  }
}

async function loadGlobalSheet(fileUri) {
  try {
    await browser.sheet.loadGlobal(fileUri);
    console.log(`[${HOST_NAME}] global sheet loaded: ${fileUri}`);
  } catch (e) {
    console.error(`[${HOST_NAME}] global sheet load failed:`, e);
  }
}

connect();
