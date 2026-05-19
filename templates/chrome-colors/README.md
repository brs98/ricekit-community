<img align="center" src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" /><br />
<h2 align="center">Ricekit for <a href="https://www.google.com/chrome/" rel="noreferrer noopener" target="_blank">Google Chrome</a></h2>

<img align="center" src="https://raw.githubusercontent.com/brs98/ricekit-community/main/templates/chrome-colors/preview.png" />

### Usage

Chrome reads enterprise policy from a different store on each OS. Setup is per-OS; the rendered file is the same on both. Both setups need a one-time sudo step — Chrome's policy mechanism only honors values from a system-managed location (Mandatory level). User-domain writes show up in `chrome://policy` as Recommended and don't actually theme the UI.

#### macOS — one-time setup (requires sudo)

```bash
sudo mkdir -p "/Library/Managed Preferences/$USER"
sudo touch "/Library/Managed Preferences/$USER/com.google.Chrome.plist"
sudo chown "$USER" "/Library/Managed Preferences/$USER" "/Library/Managed Preferences/$USER/com.google.Chrome.plist"
```

After ownership flips to your user, every reload writes `BrowserThemeColor` through `defaults` (no sudo) and asks the running Chrome to refresh. Chrome reads from `/Library/Managed Preferences` via CFPreferences and treats values there as Mandatory.

#### Linux — one-time symlink (requires sudo)

```bash
sudo mkdir -p /etc/opt/chrome/policies/managed
sudo ln -sf ~/.config/ricekit/active/chrome-colors/policy.json /etc/opt/chrome/policies/managed/ricekit.json
```

After the symlink is in place, every reload re-renders the file in your home dir; Chrome re-reads it through the symlink when `--refresh-platform-policy` fires. No further sudo needed.

#### Verifying

Open `chrome://policy` and look for `BrowserThemeColor`. The Level column should read "Mandatory" with status "OK". If it says "Recommended", the macOS one-time setup hasn't been applied (or `chown` didn't take). If the row is missing, Chrome hasn't reloaded policy yet — try `--refresh-platform-policy` from the `chrome://policy` page.

#### Notes

- This makes Chrome show "Managed by your organization" in the menu (any policy does). That's expected.
- Per-page theming (Catppuccin userstyles) is owned by the userstyles config + Stylus. This template only colors Chrome's own UI.
