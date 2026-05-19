<img align="center" src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" /><br />
<h2 align="center">Ricekit for <a href="https://linear.app" rel="noreferrer noopener" target="_blank">Linear</a></h2>

<img align="center" src="https://raw.githubusercontent.com/brs98/ricekit-community/main/templates/linear-desktop/preview.png" />

### Usage

#### macOS setup

1. Enable this template and apply your Ricekit theme.
2. Run:

   ```bash
   rkpatch linear install
   ```

3. Restart Linear.

On macOS Sequoia (15+), the first install prints a one-line "macOS is blocking in-place edits — relocating to staging" notice. That's expected — `rkpatch` transparently copies the bundle aside, patches the copy, and atomically swaps it into `/Applications`. Subsequent installs go in place.

#### Recovery

```bash
rkpatch linear restore
```

Requires the `rkpatch` binary built from `tools/rkpatch/` in the `ricekit-community` repo and added to PATH:

```bash
cd tools/rkpatch && cargo install --path .
```

If install fails with a filesystem permission error, retry with `sudo rkpatch linear install`.
