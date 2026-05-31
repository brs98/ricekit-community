<div align="center">
<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" />
<h2>Ricekit for <a href="https://alacritty.org" rel="noreferrer noopener" target="_blank">Alacritty</a></h2>
</div>

### Usage

If `~/.config/alacritty/alacritty.toml` does not exist yet, RiceKit can create it for you.

Otherwise add this under `[general]` in your existing `alacritty.toml`:

```toml
[general]
import = ["~/.config/alacritty/ricekit-theme.toml"]
```

Then reopen Alacritty.
