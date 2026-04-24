# Slack Desktop Ricekit Injection

This template renders `~/.config/ricekit/active/slack-desktop/ricekit-vars.css`
(Ricekit palette as CSS custom properties) and ships a static
`ricekit-app.css` (the shared Slack userstyle body). The patch helper injects
both files into Slack's Electron web contents via `webContents.insertCSS`.

## Setup

```bash
node ~/.config/ricekit/custom-configs/slack-desktop/patch.mjs status
node ~/.config/ricekit/custom-configs/slack-desktop/patch.mjs install
# If status printed a permission error:
sudo node ~/.config/ricekit/custom-configs/slack-desktop/patch.mjs install
```

## Recovery

```bash
node ~/.config/ricekit/custom-configs/slack-desktop/patch.mjs restore
```

## Known side effects

- **Ad-hoc resigning.** The helper runs `codesign --force --deep --sign -` after
  modifying the ASAR. This replaces Slack's original Apple Developer signature
  with an ad-hoc one. Slack's auto-updater may refuse to apply delta updates or
  may silently overwrite the entire app bundle, reverting the patch.
- **App updates revert the patch.** Every Slack update replaces
  `/Applications/Slack.app`. Re-run `install` after each update. Run `status`
  periodically to check whether the marker is still present.
- **Shared CSS refresh.** `ricekit-app.css` only updates when the userstyle
  source in this repo changes. To pick up such a change, rebuild userstyles
  (`deno task build` in `userstyles/`) and re-apply this template so the fresh
  copy lands in `~/.config/ricekit/custom-configs/slack-desktop/`. The injected
  main-process JS re-reads both files on every `dom-ready`/`did-finish-load`,
  so once the files are fresh, a reload (quit + relaunch) is enough.
- **Theme palette refresh.** `ricekit-vars.css` is rendered by Ricekit on every
  theme change. The template's `[reload.macos]` command quits Slack, waits for
  exit, then relaunches so the new palette takes effect immediately.
