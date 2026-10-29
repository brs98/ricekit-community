<div align="center">
<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" />
<h2>Ricekit for <a href="https://iterm2.com" rel="noreferrer noopener" target="_blank">iTerm2</a></h2>
</div>

### Usage

RiceKit writes a [Dynamic Profile](https://iterm2.com/documentation-dynamic-profiles.html) named **RiceKit** to:

```
~/Library/Application Support/iTerm2/DynamicProfiles/ricekit.json
```

In iTerm2, open **Settings → Profiles**, select **RiceKit**, and choose **Other Actions → Set as Default**.

iTerm2 reloads the file on every theme apply, so open sessions using the RiceKit profile recolor live. Settings RiceKit doesn't manage (font, window size, keys) are inherited from your default profile. iTerm2 doesn't save edits made to a Dynamic Profile in its Settings window, so change fonts and other settings on your regular profile instead.

Requires RiceKit with the `r_float`/`g_float`/`b_float` template functions.
