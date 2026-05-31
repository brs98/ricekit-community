<div align="center">
<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" />
<h2>Ricekit for <a href="https://wezterm.org" rel="noreferrer noopener" target="_blank">WezTerm</a></h2>

<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/templates/wezterm-colors/preview.png" />
</div>

### Usage

If `~/.config/wezterm/wezterm.lua` does not exist yet, RiceKit can create a minimal one for you.

Otherwise add this to your WezTerm config (`~/.wezterm.lua` or `~/.config/wezterm/wezterm.lua`):

```lua
local ricekit_colors = dofile(wezterm.config_dir .. '/ricekit-colors.lua')
config.colors = ricekit_colors
```

Then open a new WezTerm window.
