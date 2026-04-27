# Linear Desktop Ricekit Injection

Ricekit themes Linear by driving Linear's own "Custom" interface theme.
Linear's native theme accepts a JSON shape (`{base, accent, contrast, sidebar}`)
and derives every internal color variable from it. `ricekit-theme.user.js`
reads the active rk palette off `:root`, converts it to CIE LCH, and pushes it
into Linear's MobX store via `setCurrentCustomTheme(...) + save()`. The store
is located by walking from a sentinel-captured UserSettings instance to
`instance.store.user.settings`. The persisted theme syncs back from the server
on every reload, so this only fires when the rk palette differs from what
Linear already has.

Only `ricekit-vars.css` is injected via `webContents.insertCSS` — it sets the
`--rk-*` custom properties on `:root` so the userscript can read them. There
is no fallback CSS: layering a stylesheet on top of Linear's native theme
fights the theme system and produces worse results than the native path alone.

The same `ricekit-theme.user.js` is also distributed as a Tampermonkey
userscript for users who run Linear in a regular browser tab — drop it into
Tampermonkey, no extra config.

## Setup

Patching is handled by the standalone `rkpatch` binary (built from
`tools/rkpatch/` in this repo). Build it once and put it on `PATH`, then:

```bash
rkpatch linear status
rkpatch linear install
# If status printed a permission error:
sudo rkpatch linear install
```

`rkpatch linear install` reads `ricekit-theme.user.js`, embeds its content as
a JSON-stringified literal into `ricekit-inject.js` (substituting the
`__RICEKIT_THEME_JS__` placeholder declared in `tools/rkpatch/configs/linear.toml`),
and writes the combined payload into Linear's `app.asar`. At runtime the
injector calls `frame.executeJavaScript` with the embedded script on every
`frame-created` event so the userscript runs at document-start in the renderer.

## Recovery

```bash
rkpatch linear restore
```

## Tampermonkey usage

For browser-tab Linear, install `ricekit-theme.user.js` in Tampermonkey
unchanged. The `@match https://linear.app/*` rule scopes it correctly. A
global ricekit Stylus userstyle that sets `--rk-*` on `:root` for `linear.app`
is required so the userscript has colors to read.

## Known side effects

- **Ad-hoc resigning.** The helper runs `codesign --force --deep --sign -`
  after modifying the ASAR. This replaces Linear's original Apple Developer
  signature with an ad-hoc one. Linear's auto-updater may refuse delta updates
  or silently overwrite the bundle, reverting the patch.
- **App updates revert the patch.** Every Linear update replaces
  `/Applications/Linear.app`. Re-run `install` after each update.
- **First custom-theme application is server-synced.** On a brand-new login,
  Linear ships with `theme: 'system'`. The userscript switches that to
  `'custom'` and writes our LCH theme; the change syncs to the server, so it
  also affects Linear in other browsers / on mobile until you switch back.

## Hook stability

The userscript intentionally avoids hardcoded file names or class hashes —
Linear rotates its bundle filenames (e.g. `store.8KYjzhdI.js` →
`store.Db066w_C.js`) on every deploy. Forward-compat strategy:

- **Sentinel via `Object.prototype.toggleNotificationBadge`** — the
  UserSettings constructor assigns `this.toggleNotificationBadge = ...`, and
  Linear's minifier preserves this name because MobX persists its action by
  name string. The sentinel runs at document-start and captures any instance
  whose prototype chain has `setCurrentCustomTheme`. Backups: a couple of
  other `toggle*` action names as fallback if Linear ever splits this class.
- **Live instance via `anchor.store.user.settings`** — the sentinel often
  catches a bootstrap UserSettings that gets superseded by server hydration.
  We navigate from any captured instance through stable accessor names
  (`store`, `user`, `settings`) to the active one.

If a future Linear release renames `setCurrentCustomTheme` or
`toggleNotificationBadge`, the userscript will silently no-op (it logs to the
console; check with `window.__ricekitLinearTheme`). At that point, update the
sentinel name list in `ricekit-theme.user.js`.
