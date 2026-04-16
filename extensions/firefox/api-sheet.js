// WebExtension experiment API: register a single user-origin stylesheet via
// nsIStyleSheetService, applied globally across all documents in all windows
// (including newly-opened tabs / windows). Calling apply() again replaces the
// previously-registered sheet, triggering a full repaint with new values —
// no page refresh required.
//
// This API drives the web-page side of Ricekit theming (used by the
// ricekit-community/userstyles pipeline). The sibling `stylesheet` API
// handles chrome/userChrome.css reloads — different scopes, different
// underlying XPCOM calls.

"use strict";

/* global ExtensionAPI, ExtensionError, Cc, Ci, Services */

let currentUri = null;

function step(label, fn) {
  try {
    return fn();
  } catch (e) {
    throw new ExtensionError(
      `sheet.apply failed at step "${label}": ${e && e.message ? e.message : e}`,
    );
  }
}

this.sheet = class extends ExtensionAPI {
  getAPI(_context) {
    return {
      sheet: {
        async apply(css) {
          const sss = step("get sheet-service", () =>
            Cc["@mozilla.org/content/style-sheet-service;1"]
              .getService(Ci.nsIStyleSheetService));

          // Unregister previous — best-effort, don't fail apply if this throws.
          if (currentUri) {
            try {
              if (sss.sheetRegistered(currentUri, sss.USER_SHEET)) {
                sss.unregisterSheet(currentUri, sss.USER_SHEET);
              }
            } catch (_e) {
              // swallow — a broken unregister is not fatal
            }
          }

          // Percent-encode non-ASCII directly in the data: URI, no base64.
          // btoa() sometimes isn't available in parent-process script contexts.
          const dataUri = step("build data URI", () =>
            "data:text/css;charset=utf-8," + encodeURIComponent(css));

          const uri = step("newURI", () => Services.io.newURI(dataUri));

          step("loadAndRegisterSheet", () =>
            sss.loadAndRegisterSheet(uri, sss.USER_SHEET));

          currentUri = uri;
          return { applied: true, bytes: css.length };
        },
      },
    };
  }
};
