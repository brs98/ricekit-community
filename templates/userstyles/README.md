<div align="center">
<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" />
<h2>Ricekit for <a href="https://github.com/openstyles/stylus" rel="noreferrer noopener" target="_blank">Userstyles</a></h2>
</div>

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

### Userstyles ecosystem

The bulk of supported sites comes from upstream [Catppuccin Userstyles](https://github.com/catppuccin/userstyles). The build tooling under [`userstyles/`](../../userstyles/) redirects each style to Ricekit's Catppuccin standard-library adapter and converts dynamic LESS color math (`fade`, `lighten`) into CSS relative-color syntax. Accepted styles remain `.user.less` files with `@preprocessor less`; unsupported styles are excluded with a build warning. The accepted styles are included in the Stylus-importable `build/import.json`. The `rk-vars.css` rendered by this template provides the `--rk-*` values they read at runtime, including SVG alpha-mask filters whose colors are rendered from the active theme's RGB channels without JavaScript.

Sites Catppuccin doesn't cover are welcome as **ricekit-native userstyles**. These are not transformed and are written directly against `--rk-*` variables. The build loop bundles them into the same `import.json` alongside the transformed Catppuccin styles. See [`userstyles/README.md`](../../userstyles/README.md) for the full pipeline.
