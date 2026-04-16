# Ricekit-native userstyles

This directory is for userstyles that ricekit ships *independently* of Catppuccin — sites that Catppuccin doesn't theme, or alternate takes we want to bundle alongside.

The Catppuccin userstyles are pulled from the `upstream/catppuccin/` submodule and transformed at build time. They are **not** copied here.

## Layout (when first userstyle lands)

```
styles/
  <site-slug>/
    ricekit.user.less   # or .user.css
```

The build pipeline will pick these up automatically and fold them into `build/import.json` alongside the transformed Catppuccin stylesheets.
