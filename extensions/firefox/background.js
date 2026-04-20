// Ricekit — live browser + web-page theming via native messaging.
//
// Single native host (`ricekit`, registered by ricekit main) emits one generic
// message per rendered file under ~/.config/ricekit/active/:
//
//   file_update { config, fileName, fileUri, content }
//     → routed by `config` name in handleFileUpdate():
//         config === "userstyles"  → browser.sheet.loadGlobal(fileUri)
//         config === "firefox"     → browser.theme.update(colors) + tab group CSS via sheet.loadCSS
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
  let parsed;
  try {
    parsed = JSON.parse(colorsJson);
  } catch (e) {
    console.error(`[${HOST_NAME}] Firefox theme colors parse failed:`, e);
    return;
  }

  if (parsed.colors) {
    browser.theme.update({ colors: parsed.colors }).then(
      () => console.log(`[${HOST_NAME}] Firefox theme applied`),
      (err) => console.error(`[${HOST_NAME}] Firefox theme failed:`, err),
    );
  }

  if (parsed.tab_group_colors) {
    applyTabGroupColors(parsed.tab_group_colors);
  }
}

function applyTabGroupColors(colors) {
  const rootRules = [];
  const groupRules = [];

  for (const [name, v] of Object.entries(colors)) {
    rootRules.push(`  --tab-group-color-${name}: ${v.base} !important;`);
    rootRules.push(`  --tab-group-color-${name}-invert: ${v.invert} !important;`);
    rootRules.push(`  --tab-group-color-${name}-pale: ${v.pale} !important;`);

    groupRules.push(
      `tab-group[color="${name}"] {\n` +
      `  --tab-group-color: ${v.base} !important;\n` +
      `  --tab-group-color-invert: ${v.invert} !important;\n` +
      `  --tab-group-color-pale: ${v.pale} !important;\n` +
      `}`,
    );
  }

  const css = `:root {\n${rootRules.join("\n")}\n}\n\n${groupRules.join("\n\n")}`;
  browser.sheet.loadCSS("tab-group-colors", css).then(
    () => console.log(`[${HOST_NAME}] tab group colors applied`),
    (err) => console.error(`[${HOST_NAME}] tab group colors failed:`, err),
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
