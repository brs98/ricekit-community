// WebExtension experiment API: register a single user-origin stylesheet via
// nsIStyleSheetService.loadAndRegisterSheet, applied globally across all
// documents in all windows (chrome + content). Calling loadGlobal() again
// unregisters the previous sheet and registers the new one, triggering a
// full repaint with new values — no page refresh required.
//
// The sibling `stylesheet` API handles chrome/userChrome.css reloads via
// windowUtils — different scopes, different underlying XPCOM calls.

"use strict";

/* global ExtensionAPI, ExtensionError, Cc, Ci, Services */

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

            const uri = Services.io.newURI(fileUri);
            sss.loadAndRegisterSheet(uri, sss.USER_SHEET);
            currentUri = uri;
            return { applied: true };
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
