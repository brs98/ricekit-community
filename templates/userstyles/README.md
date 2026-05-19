<img align="center" src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" /><br />
<h2 align="center">Ricekit for <a href="https://github.com/catppuccin/userstyles" rel="noreferrer noopener" target="_blank">Catppuccin Userstyles</a></h2>

### Usage

This config renders `~/.config/ricekit/active/userstyles/rk-vars.css` containing the 22 ricekit ANSI+semantic tokens and 13 OKLCH-derived Catppuccin slots as CSS custom properties.

#### Option A — live reload via Ricekit Firefox addon

1. Run the native-messaging host setup:

   ```bash
   ricekit browser setup
   ```

2. Install the Ricekit addon from this repo:
   - XPI: `extensions/firefox/dist/ricekit-theme-<version>.xpi`
   - Or for dev: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `extensions/firefox/manifest.json`

3. Install the Stylus userstyles bundle: `build/import.json` → Stylus → Manage → Import. Stylus auto-updates each style via `@updateURL` on its 24h poll.

#### Option B — static fallback (no addon)

```css
@import url("file:///Users/<you>/.config/ricekit/active/userstyles/rk-vars.css");
```

in your `userContent.css`, or paste the file contents into a Stylus userstyle with "Applies to: All URLs".
