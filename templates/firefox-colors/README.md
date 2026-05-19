<div align="center">
<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" />
<h2>Ricekit for <a href="https://www.mozilla.org/firefox/" rel="noreferrer noopener" target="_blank">Firefox</a></h2>

<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/templates/firefox-colors/preview.png" />
</div>

### Usage

1. Register the native messaging host:

   ```bash
   ricekit browser setup
   ```

2. Install the Ricekit extension:
   - Open `about:debugging#/runtime/this-firefox` in your browser
   - Click "Load Temporary Add-on"
   - Select `manifest.json` from `~/.config/ricekit/extensions/firefox/`

   > Temporary add-ons are removed on browser restart. Re-load the extension after each restart, or install from AMO once available.
