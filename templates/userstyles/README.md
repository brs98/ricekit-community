<img align="center" src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" /><br />
<h2 align="center">Ricekit for <a href="https://github.com/openstyles/stylus" rel="noreferrer noopener" target="_blank">Userstyles</a></h2>

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

The bulk of supported sites comes from upstream [Catppuccin Userstyles](https://github.com/catppuccin/userstyles), which the build tooling under [`userstyles/`](../../userstyles/) **transforms at build time** — rewriting LESS palette refs like `@accent` and `@red` into `var(--rk-accent)` and `var(--rk-red)`, and converting LESS color math (`fade`, `lighten`) into CSS relative-color syntax. Every compiled style ends up in a single Stylus-importable `build/import.json`. The `rk-vars.css` rendered by this template provides the `--rk-*` values those compiled styles read at runtime.

Sites Catppuccin doesn't cover are welcome as **ricekit-native userstyles**. Drop a `ricekit.user.less` (or `.user.css`) into [`userstyles/styles/<site-slug>/`](../../userstyles/styles/) — these aren't transformed and are written directly against `--rk-*` variables. The build loop bundles them into the same `import.json` alongside the compiled Catppuccin ones. See [`userstyles/README.md`](../../userstyles/README.md) for the full pipeline.
