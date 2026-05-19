<div align="center">
<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" />
<h2>Ricekit for <a href="https://github.com/manaflow-ai/cmux" rel="noreferrer noopener" target="_blank">cmux</a></h2>
</div>

### Usage

cmux stores its theme palette in a Ghostty-format file at:

```
~/Library/Application Support/com.cmuxterm.app/config.ghostty
```

Run once to clear any built-in cmux theme override and hand the file over to ricekit:

```bash
cmux themes clear
```

After that, every `ricekit apply` rewrites the file with the active palette and reloads cmux via `cmux reload-config`. Non-color terminal settings (font, opacity, keybinds) belong in your regular Ghostty config and are unaffected.
