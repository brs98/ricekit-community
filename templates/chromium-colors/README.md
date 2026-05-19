<div align="center">
<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" />
<h2>Ricekit for <a href="https://www.chromium.org/Home/" rel="noreferrer noopener" target="_blank">Chromium</a></h2>

<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/templates/chromium-colors/preview.png" />
</div>

### Usage

Chromium reads enterprise policy from a different store on each OS. Setup is per-OS; the rendered file is the same on both. Both setups need a one-time sudo step — Chromium's policy mechanism only honors values from a system-managed location (Mandatory level). User-domain writes show up in `chrome://policy` as Recommended and don't actually theme the UI.

#### macOS — one-time setup (requires sudo)

```bash
sudo mkdir -p "/Library/Managed Preferences/$USER"
sudo touch "/Library/Managed Preferences/$USER/org.chromium.Chromium.plist"
sudo chown "$USER" "/Library/Managed Preferences/$USER" "/Library/Managed Preferences/$USER/org.chromium.Chromium.plist"
```

After ownership flips to your user, every reload writes `BrowserThemeColor` through `defaults` (no sudo) and asks the running Chromium to refresh. Chromium reads from `/Library/Managed Preferences` via CFPreferences and treats values there as Mandatory.

#### Linux — one-time symlink (requires sudo)

```bash
sudo mkdir -p /etc/chromium/policies/managed
sudo ln -sf ~/.config/ricekit/active/chromium-colors/policy.json /etc/chromium/policies/managed/ricekit.json
```

After the symlink is in place, every reload re-renders the file in your home dir; Chromium re-reads it through the symlink when `--refresh-platform-policy` fires. No further sudo needed.

#### Verifying

Open `chrome://policy` and look for `BrowserThemeColor`. The Level column should read "Mandatory" with status "OK". If it says "Recommended", the macOS one-time setup hasn't been applied (or `chown` didn't take). If the row is missing, Chromium hasn't reloaded policy yet — try `--refresh-platform-policy` from the `chrome://policy` page.

#### Notes

- This makes Chromium show "Managed by your organization" in the menu (any policy does). That's expected.
- Per-page theming (Catppuccin userstyles) is owned by the userstyles config + Stylus. This template only colors Chromium's own UI.
