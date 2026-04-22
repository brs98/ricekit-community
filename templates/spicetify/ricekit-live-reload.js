(function ricekitLiveReload() {
  if (!Spicetify) {
    setTimeout(ricekitLiveReload, 300);
    return;
  }

  var POLL_MS = 2000;
  var linkEl = document.createElement("link");
  linkEl.rel = "stylesheet";
  linkEl.href = "ricekit-live.css";
  document.head.appendChild(linkEl);

  setInterval(function () {
    linkEl.href = "ricekit-live.css?" + Date.now();
  }, POLL_MS);
})();
