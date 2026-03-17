// WebExtension Experiment API for reloading userChrome.css at runtime.
// Uses windowUtils.removeSheet/loadSheet on the browser window to force
// Zen Browser to re-read the CSS file without restarting.

"use strict";

/* global ExtensionAPI, Services */

this.stylesheet = class extends ExtensionAPI {
  getAPI(_context) {
    return {
      stylesheet: {
        async reload(fileUri) {
          const start = Date.now();
          const uri = Services.io.newURI(fileUri);
          const windowEnumerator = Services.wm.getEnumerator("navigator:browser");

          let count = 0;
          while (windowEnumerator.hasMoreElements()) {
            const win = windowEnumerator.getNext();
            const utils = win.windowUtils;
            try {
              utils.removeSheet(uri, utils.USER_SHEET);
            } catch (_e) {
              // Sheet may not be loaded yet — that's fine.
            }
            utils.loadSheet(uri, utils.USER_SHEET);
            count++;
          }

          return { windows: count, elapsed: Date.now() - start };
        },
      },
    };
  }
};
