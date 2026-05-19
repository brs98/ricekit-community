<div align="center">
<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" />
<h2>Ricekit for <a href="https://obsidian.md" rel="noreferrer noopener" target="_blank">Obsidian</a></h2>
</div>

### Usage

Obsidian stores themes per-vault, not globally. Ricekit renders one canonical CSS file and the reload step fans it out to every vault listed in Obsidian's `obsidian.json`.

One-time per vault:

1. Apply your theme: `ricekit apply <theme>`
2. Open the vault in Obsidian
3. Settings → Appearance → CSS snippets → reload, then toggle `ricekit` on
4. Subsequent applies hot-reload automatically (Obsidian watches snippet mtime)

If you add a new vault later, re-run `ricekit apply` to seed `ricekit.css` into it, then enable the snippet once.
