// Ricekit — page-side rk-vars injection.
//
// Reads the cached userstyles rk-vars.css content from chrome.storage.local
// and injects it as a <style> in the document. Updates whenever the service
// worker writes new content (file_update from the native host).
//
// First-run race: storage.get is async and document_start fires before the
// HTML body parses. The :root selector inside rk-vars.css resolves at
// style-recalc time, so even a few ms of delay just means var(--rk-*) is
// briefly unresolved. Subsequent in-page updates apply instantly via the
// onChanged listener.

"use strict";

const STYLE_ID = "ricekit-rk-vars";
const STORAGE_KEY = "rk_vars_css";

function injectStyle(css) {
  if (!css) return;
  const root = document.documentElement;
  if (!root) return;
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    root.appendChild(el);
  }
  if (el.textContent !== css) {
    el.textContent = css;
  }
}

chrome.storage.local.get(STORAGE_KEY, (items) => {
  const css = items && items[STORAGE_KEY];
  if (css) {
    injectStyle(css);
  } else {
    // Worker may be asleep and storage empty (fresh install or wiped state).
    // Asking the worker to wake will (a) restart the native-host connection
    // and (b) trigger the host's send_all_updates, which lands the css in
    // storage; onChanged then injects it.
    try {
      chrome.runtime.sendMessage({ type: "request_state" });
    } catch (_) {
      // Extension context invalidated (during reload) — harmless.
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const change = changes[STORAGE_KEY];
  if (change && typeof change.newValue === "string") {
    injectStyle(change.newValue);
  }
});
