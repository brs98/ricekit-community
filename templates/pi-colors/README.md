<img align="center" src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" /><br />
<h2 align="center">Ricekit for <a href="https://github.com/earendil-works/pi" rel="noreferrer noopener" target="_blank">Pi</a></h2>

### Usage

Enable this template, apply a RiceKit theme, then select the generated Pi theme with `/settings` or set `theme` to `ricekit` in `~/.pi/agent/settings.json`.

RiceKit writes `~/.pi/agent/themes/ricekit.json` as a symlink to the rendered palette file under `~/.config/ricekit/active/pi/ricekit.json`. Pi watches the themes directory, and RiceKit recreates the symlink on every apply so the active Pi theme can hot-reload.
