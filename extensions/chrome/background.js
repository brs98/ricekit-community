// Ricekit — Chrome MV3 service worker.
//
// Connects to the `ricekit` native messaging host (registered by
// `ricekit browser setup`) and stores the live `userstyles` rk-vars.css
// content in chrome.storage.local. The content script picks it up from
// storage and injects it into every page so Stylus userstyles can resolve
// var(--rk-*).
//
// MV3 service workers are ephemeral — they sleep when idle and reawake on
// events. The native-messaging port dies with the worker, so we reconnect
// on every wake event. Storage is the canonical source of truth between
// wakes; a stale port just means we won't see new file_updates until the
// next wake, at which point reconnect + the host's initial state-flush
// catches us up.
//
// Message types from the host (see ricekit/crates/ricekit-cli/src/commands/browser.rs):
//   file_update { config, fileName, fileUri, content }
//
// Only `config === "userstyles"` is consumed in Chrome. Other configs
// (firefox, zen-colors) are ignored — they're addon-specific.

"use strict";

const HOST_NAME = "ricekit";
const STORAGE_KEY = "rk_vars_css";

let port = null;
let reconnectTimer = null;

function ensureConnected() {
  if (port) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    port = chrome.runtime.connectNative(HOST_NAME);
    console.log(`[${HOST_NAME}] connected to native host`);

    port.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "file_update" && msg.config === "userstyles" && typeof msg.content === "string") {
        chrome.storage.local.set({ [STORAGE_KEY]: msg.content });
      }
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      console.log(`[${HOST_NAME}] disconnected:`, err ? err.message : "clean");
      port = null;
      // Reconnect attempt — may not fire if the worker sleeps before it does,
      // but the next wake event will call ensureConnected() again.
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        ensureConnected();
      }, 5000);
    });
  } catch (e) {
    console.error(`[${HOST_NAME}] connection error:`, e);
    port = null;
  }
}

chrome.runtime.onStartup.addListener(ensureConnected);
chrome.runtime.onInstalled.addListener(ensureConnected);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ensureConnected();
  if (msg && msg.type === "request_state" && port) {
    try {
      port.postMessage({ type: "request_state" });
    } catch (e) {
      console.error(`[${HOST_NAME}] request_state failed:`, e);
    }
  }
  sendResponse({ ok: true });
  return false;
});

ensureConnected();
