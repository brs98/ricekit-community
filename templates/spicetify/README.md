<div align="center">
<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" />
<h2>Ricekit for <a href="https://spicetify.app" rel="noreferrer noopener" target="_blank">Spicetify</a></h2>

<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/templates/spicetify/preview.png" />
</div>

### Usage

One-time setup:

1. Copy `user.css` to your spicetify theme directory:

   ```bash
   mkdir -p ~/.config/spicetify/Themes/ricekit
   cp ~/.config/ricekit/custom-configs/spicetify/user.css ~/.config/spicetify/Themes/ricekit/
   ```

2. Copy the live-reload extension:

   ```bash
   cp ~/.config/ricekit/custom-configs/spicetify/ricekit-live-reload.js ~/.config/spicetify/Extensions/
   ```

3. Configure spicetify:

   ```bash
   spicetify config current_theme ricekit color_scheme ricekit extensions ricekit-live-reload.js
   ```

4. Apply:

   ```bash
   spicetify apply
   ```
