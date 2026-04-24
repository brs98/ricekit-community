# Linear Desktop Ricekit Injection

This template renders `~/.config/ricekit/active/linear-desktop/ricekit-vars.css`
and ships a static `ricekit-app.css` (the shared Linear userstyle body). The
patch helper injects both files into Linear's Electron web contents via
`webContents.insertCSS`.

## Setup

```bash
node ~/.config/ricekit/custom-configs/linear-desktop/patch.mjs status
node ~/.config/ricekit/custom-configs/linear-desktop/patch.mjs install
# If status printed a permission error:
sudo node ~/.config/ricekit/custom-configs/linear-desktop/patch.mjs install
```

## Recovery

```bash
node ~/.config/ricekit/custom-configs/linear-desktop/patch.mjs restore
```

## Known side effects

- **Ad-hoc resigning.** The helper runs `codesign --force --deep --sign -`
  after modifying the ASAR. This replaces Linear's original Apple Developer
  signature with an ad-hoc one. Linear's auto-updater may refuse delta updates
  or silently overwrite the bundle, reverting the patch.
- **App updates revert the patch.** Every Linear update replaces
  `/Applications/Linear.app`. Re-run `install` after each update.
- **Shared CSS refresh.** `ricekit-app.css` only updates when the userstyle
  source in this repo changes. To pick up such a change, rebuild userstyles
  and re-apply this template so the fresh copy lands in
  `~/.config/ricekit/custom-configs/linear-desktop/`. A Linear reload
  (quit + relaunch, triggered by Ricekit's reload command) re-reads the files.
