// WebExtension experiment API: register named user-origin stylesheets via
// nsIStyleSheetService.loadAndRegisterSheet, applied globally across all
// documents (chrome + content). Multiple sheets can coexist by name —
// re-registering the same name unregisters the previous sheet first.
//
// loadGlobal(fileUri)  — read file, register as data: URI (name: "global")
// loadCSS(name, css)   — register raw CSS text as data: URI by name

"use strict";

/* global ExtensionAPI, ExtensionError, Cc, Ci, Services, IOUtils */

const registeredSheets = new Map();

function getSSS() {
  return Cc["@mozilla.org/content/style-sheet-service;1"]
    .getService(Ci.nsIStyleSheetService);
}

function unregisterByName(name) {
  const prev = registeredSheets.get(name);
  if (!prev) return;
  try {
    const sss = getSSS();
    if (sss.sheetRegistered(prev, sss.USER_SHEET)) {
      sss.unregisterSheet(prev, sss.USER_SHEET);
    }
  } catch (_e) {
    // Best-effort — a broken unregister must not block the new load.
  }
  registeredSheets.delete(name);
}

function registerCSS(name, cssText) {
  const sss = getSSS();
  unregisterByName(name);
  const dataUri = "data:text/css;charset=utf-8," + encodeURIComponent(cssText);
  const uri = Services.io.newURI(dataUri);
  sss.loadAndRegisterSheet(uri, sss.USER_SHEET);
  registeredSheets.set(name, uri);
  return uri;
}

this.sheet = class extends ExtensionAPI {
  getAPI(_context) {
    return {
      sheet: {
        async loadGlobal(fileUri) {
          try {
            const path = Services.io.newURI(fileUri)
              .QueryInterface(Ci.nsIFileURL).file.path;
            const css = await IOUtils.readUTF8(path);
            registerCSS("global", css);
            return { applied: true, bytes: css.length };
          } catch (e) {
            throw new ExtensionError(
              `sheet.loadGlobal failed: ${e && e.message ? e.message : e}`,
            );
          }
        },

        async loadCSS(name, cssText) {
          try {
            registerCSS(name, cssText);
            return { applied: true, bytes: cssText.length };
          } catch (e) {
            throw new ExtensionError(
              `sheet.loadCSS failed: ${e && e.message ? e.message : e}`,
            );
          }
        },
      },
    };
  }
};
