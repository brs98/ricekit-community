// Ricekit Userstyles — connects to the `ricekit_userstyles` native host and
// applies each `vars_update` message as the single active user stylesheet.
// The host pushes an update on startup and again on every ricekit theme apply.

let port = null;
let reconnectTimer = null;

function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    console.log("[ricekit-userstyles] connecting to native host...");
    port = browser.runtime.connectNative("ricekit_userstyles");

    port.onMessage.addListener(async (msg) => {
      if (msg && msg.type === "vars_update" && typeof msg.css === "string") {
        try {
          await browser.sheet.apply(msg.css);
          console.log(
            `[ricekit-userstyles] vars applied (${msg.css.length} bytes)`,
          );
        } catch (e) {
          console.error("[ricekit-userstyles] sheet.apply failed:", e);
        }
      }
    });

    port.onDisconnect.addListener(() => {
      const err = browser.runtime.lastError;
      console.log(
        "[ricekit-userstyles] disconnected:",
        err ? err.message : "clean",
      );
      port = null;
      reconnectTimer = setTimeout(connect, 3000);
    });
  } catch (e) {
    console.error("[ricekit-userstyles] connection error:", e);
    reconnectTimer = setTimeout(connect, 3000);
  }
}

connect();
