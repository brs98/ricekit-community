// Ricekit — live browser + web-page theming via native messaging.
//
// Two independent native hosts, two independent reconnect loops:
//
//   `ricekit`            (registered by main Ricekit app)
//     - theme_update      → browser.theme.update() for standard Firefox chrome
//     - stylesheet_update → browser.stylesheet.reload() for Zen userChrome.css
//
//   `ricekit_userstyles` (registered by ricekit-community/userstyles install.ts)
//     - vars_update       → browser.sheet.apply() — registers a global
//                           user-origin stylesheet holding :root { --ctp-* }
//                           variables that the Catppuccin userstyles resolve.
//
// Either host may be missing (user hasn't run the other side's install). Each
// port reconnects independently on disconnect so a missing host doesn't spam
// the other's logs.

const HOSTS = {
  ricekit: {
    reconnectMs: 5000,
    handlers: {
      theme_update: (msg) => {
        if (msg.colors) applyFirefoxTheme(msg.colors);
      },
      stylesheet_update: (msg) => {
        if (msg.fileUri) reloadStylesheet(msg.fileUri);
      },
    },
  },
  ricekit_userstyles: {
    reconnectMs: 3000,
    handlers: {
      vars_update: async (msg) => {
        if (typeof msg.css === "string") {
          try {
            await browser.sheet.apply(msg.css);
            console.log(
              `[ricekit-userstyles] vars applied (${msg.css.length} bytes)`,
            );
          } catch (e) {
            console.error("[ricekit-userstyles] sheet.apply failed:", e);
          }
        }
      },
    },
  },
};

function connect(hostName) {
  const cfg = HOSTS[hostName];
  let reconnectTimer = null;

  function open() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    try {
      console.log(`[${hostName}] connecting to native host...`);
      const port = browser.runtime.connectNative(hostName);

      port.onMessage.addListener((msg) => {
        if (!msg || typeof msg !== "object") return;
        const handler = cfg.handlers[msg.type];
        if (handler) handler(msg);
      });

      port.onDisconnect.addListener(() => {
        const err = browser.runtime.lastError;
        console.log(`[${hostName}] disconnected:`, err ? err.message : "clean");
        reconnectTimer = setTimeout(open, cfg.reconnectMs);
      });
    } catch (e) {
      console.error(`[${hostName}] connection error:`, e);
      reconnectTimer = setTimeout(open, cfg.reconnectMs);
    }
  }

  open();
}

// Standard Firefox theme API (ignored by Zen, but works on Firefox).
function applyFirefoxTheme(colors) {
  browser.theme.update({ colors }).then(
    () => console.log("[ricekit] Firefox theme applied"),
    (err) => console.error("[ricekit] Firefox theme failed:", err),
  );
}

// Reload userChrome.css via experiment API (works on Zen).
async function reloadStylesheet(fileUri) {
  try {
    const result = await browser.stylesheet.reload(fileUri);
    console.log(
      `[ricekit] Stylesheet reloaded (${result.windows} window(s), ${result.elapsed}ms)`,
    );
  } catch (e) {
    console.error("[ricekit] Stylesheet reload failed:", e);
  }
}

for (const name of Object.keys(HOSTS)) connect(name);
