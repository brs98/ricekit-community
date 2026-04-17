// Ricekit — live browser + web-page theming via native messaging.
//
// Single native host (`ricekit`, registered by ricekit main), three message
// types:
//
//   theme_update              → browser.theme.update()              (Firefox chrome)
//   stylesheet_update         → browser.stylesheet.reload(fileUri)  (Zen userChrome.css)
//   content_stylesheet_update → browser.sheet.loadGlobal(fileUri)   (global, incl. content)
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
      if (msg.type === "theme_update" && msg.colors) {
        applyFirefoxTheme(msg.colors);
      } else if (msg.type === "stylesheet_update" && msg.fileUri) {
        reloadChromeSheet(msg.fileUri);
      } else if (msg.type === "content_stylesheet_update" && msg.fileUri) {
        loadGlobalSheet(msg.fileUri);
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

function applyFirefoxTheme(colors) {
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
