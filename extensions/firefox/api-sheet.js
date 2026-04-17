// WebExtension experiment API: register a single user-origin stylesheet via
// nsIStyleSheetService.loadAndRegisterSheet, applied globally across all
// documents (chrome + content). Calling loadGlobal() again unregisters the
// previous sheet and registers the new one — full repaint, no reload.
//
// Accepts a file URI, reads it in parent process, registers as a data: URI.
// file:// URIs load via loadAndRegisterSheet silently don't cascade into
// https:// content documents (USER_SHEET security gate). data: URIs do.
//
// The sibling `stylesheet` API handles userChrome.css reloads via windowUtils
// — different scopes, different XPCOM calls.

"use strict";

/* global ExtensionAPI, ExtensionError, Cc, Ci, Services, IOUtils */

let currentUri = null;

this.sheet = class extends ExtensionAPI {
  getAPI(_context) {
    return {
      sheet: {
        async loadGlobal(fileUri) {
          try {
            const sss = Cc["@mozilla.org/content/style-sheet-service;1"]
              .getService(Ci.nsIStyleSheetService);

            if (currentUri) {
              try {
                if (sss.sheetRegistered(currentUri, sss.USER_SHEET)) {
                  sss.unregisterSheet(currentUri, sss.USER_SHEET);
                }
              } catch (_e) {
                // Best-effort — a broken unregister must not block the new load.
              }
            }

            const path = Services.io.newURI(fileUri).QueryInterface(Ci.nsIFileURL).file.path;
            const css = await IOUtils.readUTF8(path);
            const dataUri = "data:text/css;charset=utf-8," + encodeURIComponent(css);
            const uri = Services.io.newURI(dataUri);

            sss.loadAndRegisterSheet(uri, sss.USER_SHEET);
            currentUri = uri;
            return { applied: true, bytes: css.length };
          } catch (e) {
            throw new ExtensionError(
              `sheet.loadGlobal failed: ${e && e.message ? e.message : e}`,
            );
          }
        },
      },
    };
  }
};
