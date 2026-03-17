// Ricekit — live browser theming via native messaging
//
// Connects to the `ricekit` native messaging host, which watches for theme
// changes and pushes updates. Uses two mechanisms:
//   1. browser.theme.update() — for standard Firefox (browser.theme API)
//   2. browser.stylesheet.reload() — for Zen Browser (reloads userChrome.css)

let port = null;
let reconnectTimer = null;

function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    console.log("[ricekit] Connecting to native host...");
    port = browser.runtime.connectNative("ricekit");

    port.onMessage.addListener((message) => {
      if (message.type === "theme_update" && message.colors) {
        applyFirefoxTheme(message.colors);
      }
      if (message.type === "stylesheet_update" && message.fileUri) {
        reloadStylesheet(message.fileUri);
      }
    });

    port.onDisconnect.addListener(() => {
      const err = browser.runtime.lastError;
      console.log("[ricekit] Disconnected:", err ? err.message : "clean");
      port = null;
      reconnectTimer = setTimeout(connect, 5000);
    });
  } catch (e) {
    console.error("[ricekit] Connection error:", e);
    reconnectTimer = setTimeout(connect, 5000);
  }
}

// Standard Firefox theme API (ignored by Zen, but works on Firefox).
function applyFirefoxTheme(colors) {
  browser.theme.update({ colors }).then(
    () => console.log("[ricekit] Firefox theme applied"),
    (err) => console.error("[ricekit] Firefox theme failed:", err)
  );
}

// Reload userChrome.css via experiment API (works on Zen).
async function reloadStylesheet(fileUri) {
  try {
    const result = await browser.stylesheet.reload(fileUri);
    console.log(
      `[ricekit] Stylesheet reloaded (${result.windows} window(s), ${result.elapsed}ms)`
    );
  } catch (e) {
    console.error("[ricekit] Stylesheet reload failed:", e);
  }
}

connect();
