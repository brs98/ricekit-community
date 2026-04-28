# Ricekit Integrations

Integrations are the third type of Ricekit content (after themes and config templates). They fire an HTTP request on every theme apply — pushing the active palette to smart bulbs, home-automation servers, status-page widgets, anything reachable over the network. There is no rendered file on disk and no `reload.command`; the request itself *is* the side effect.

If you only want to recolor terminal/editor configs, you don't need integrations — keep using the `templates/` system. Reach for an integration when the surface you're theming has no config file (smart lights, scene controllers, web hooks).

---

## What's here

| Integration | App | What it does | Reference |
| --- | --- | --- | --- |
| [`govee-color`](./govee-color/) | Govee | Sets a Govee strip/bulb to the active theme accent via the v2 Smart Home Open Platform API | Reference implementation |

More integrations land via PR — see the "Contributing an integration" section in [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## How integrations work (in 30 seconds)

1. The Ricekit core fetches `integrations/` from the latest community release tarball (or you copy them into `~/.config/ricekit/custom-integrations/`).
2. You **enable** an integration with `ricekit integration enable <name>`. This flips a flag in `state.toml`.
3. You **store the integration's secrets** (API keys, device IDs) in your macOS Keychain via `ricekit secrets set <integration> <key>`. Values never touch disk; the rendered-debug copies under `~/.config/ricekit/rendered/` keep `@@secret:KEY@@` markers verbatim and only get substituted at HTTP request time.
4. On every `ricekit apply <theme>` (or theme switch from the UI), Ricekit:
   - Renders the integration's body template against the active palette
   - Substitutes secrets into the body, headers, and URL
   - Issues the HTTP request with timeout + retry per the integration's manifest
   - Reports per-integration success/failure in the apply output

Integrations are **non-fatal**: a Govee strip being unreachable does not block your terminal config from re-rendering.

---

## Quickstart: Govee end-to-end

This is the canonical walkthrough — same shape applies to every other integration once they exist.

### 0. Prerequisites

- A Govee device that supports the v2 Smart Home Open Platform API (most RGBIC strips and bulbs from the last few years; the legacy v1 API silently no-ops on RGBIC hardware so we use v2)
- The Govee Home mobile app, signed in to the same account that owns the device

### 1. Get an API key

In the Govee Home app: **Settings → About Us → Apply for API Key**. Govee emails the key within a few minutes.

### 2. Find your device's MAC and SKU

```bash
curl -H 'Govee-API-Key: YOUR_KEY' \
     https://openapi.api.govee.com/router/api/v1/user/devices | python3 -m json.tool
```

In the response, locate the device you want to control:

- `device` is the MAC address (e.g. `AA:BB:CC:DD:EE:FF:00:11`) — note the v2 API uses an 8-octet form
- `sku` is the model code (e.g. `H6047`, `H6159`)
- Confirm `devices.capabilities` includes a `color_setting` capability with the `colorRgb` instance — that's what `govee-color` writes to

### 3. Enable the integration and store the secrets

```bash
ricekit integration enable govee-color

ricekit secrets set govee-color api_key   # paste the key from step 1
ricekit secrets set govee-color device    # paste the MAC from step 2
ricekit secrets set govee-color model     # paste the SKU from step 2
```

`secrets set` prompts for the value with hidden input — nothing echoes to the terminal and nothing gets written to a file.

The first time `ricekit-cli` writes to the keychain, macOS shows an "allow access" prompt. Pick **Always Allow** to avoid being prompted on every subsequent apply. Unsigned dev builds prompt by binary path, so a fresh `cargo build` may prompt again.

### 4. Apply a theme

```bash
ricekit apply tokyo-night
```

You should see something like:

```
Applied tokyo-night

  Configs:
    ✓ ghostty-colors
    ✓ neovim-colors
    ...

  Integrations:
    ✓ govee-color 200 (412ms)
```

The strip turns to the theme's accent color within ~1s.

### 5. Verify it's enabled

```bash
ricekit integration list
ricekit secrets list govee-color
```

`integration list` shows a green dot next to active integrations. `secrets list` shows which keys are set (it never prints values — only `set` / `missing`).

---

## Troubleshooting

### Apply succeeded, integration shows ⚠ with `app code 400: …`

Your HTTP request reached Govee but Govee rejected it at the application level. The most common causes:

| Govee message | Meaning | Fix |
| --- | --- | --- |
| `Device is offline` | The device isn't reachable from Govee's cloud (Wi-Fi dropped, power cycled, etc.) | Open the Govee Home app and confirm the device is online there. Govee's cloud sometimes lags ~30s after the device comes back; retry the apply. |
| `Invalid value` / `unsupported capability` | The device doesn't support `colorRgb` | Re-check step 2 — the device's `capabilities` array must include `devices.capabilities.color_setting` with the `colorRgb` instance. Older bulbs may only support `colorTem`. |
| `Authorization failed` | API key wrong or revoked | `ricekit secrets unset govee-color api_key && ricekit secrets set govee-color api_key` and paste the current key from the Govee Home app |

Ricekit detects these app-level failures by parsing the Govee response body and surfaces them with a `⚠` (yellow warning) line in the apply output, distinct from the `✓` (green check) that means everything succeeded. The HTTP status will be `200` because Govee returns app-level errors inside successful HTTP responses — this is why we have the inline check.

### `Missing secrets: api_key, device, model`

Run `ricekit secrets list govee-color` to see which keys are missing, then `ricekit secrets set govee-color <key>` for each. The integration won't fire until every declared secret has a value.

### `ricekit integration list` shows it as inactive after I enabled it

Two things to check:

1. **State file inspection**: there's no `ricekit state` subcommand yet (tracked in [brs98/ricekit#112](https://github.com/brs98/ricekit/issues/112)). For now, peek at the file directly:

   ```bash
   cat ~/.config/ricekit/state.toml | grep -A1 govee-color
   ```

   Each entry in `[[active_configs]]` should look like:

   ```toml
   [[active_configs]]
   name = "govee-color"
   kind = "integration"
   ```

   If you see `kind = "config"` instead (a known corruption mode from running an older binary against the new state schema), fix it with:

   ```bash
   ricekit config disable govee-color
   ricekit integration enable govee-color
   ```

2. **Stale binary**: if you have multiple Ricekit installs (a `~/.cargo/bin/ricekit` from `cargo install` *and* the binary inside the desktop app), make sure the one on your `$PATH` is recent enough to know about integrations. `ricekit --version` and a recent `git log` in the source repo will confirm.

### Daemon-triggered theme switches don't fire the integration

This is intentional. The Ricekit daemon (the `ricekit-daemon` LaunchAgent that runs your scheduled theme switches) runs under a different bundle ID than the desktop app, and macOS Keychain ACLs would surface as un-parented "allow access" prompts with no UI to dismiss them. So when the daemon runs an apply it sets `RICEKIT_DAEMON=1` and Ricekit skips Phase B (integrations) with a log line:

```
INFO ricekit_core::apply: Skipping integrations phase (RICEKIT_DAEMON=1)
```

Configs still apply normally — your terminal, editor, status bar, etc. all retheme on schedule. Only the HTTP integrations are skipped. A future daemon-IPC channel will route secret access through the desktop app and re-enable scheduled integration runs (see the closed-repo roadmap for status).

If you want a scheduled apply to fire integrations too, schedule a `ricekit apply <theme>` cron / launchd job from your user agent context instead of relying on the bundled daemon.

### Light is on but color "looks wrong" compared to the screen

Smart bulbs and strips don't perform CIE-aware color management — they take a 0-255 RGB triple and dump it through their own (usually proprietary, often non-linear) gamma curve. So the same `accent` color that looks like a bright slate-blue on a calibrated monitor can look noticeably more saturated, more cyan, or more magenta on a strip.

This is a hardware/firmware limitation of the lights, not a Ricekit bug — proper CIE-aware colorimetry is tracked in [brs98/ricekit#113](https://github.com/brs98/ricekit/issues/113). Workarounds today:

- Use `accent` for small, accent-only fixtures and let larger surfaces (ceiling lights, etc.) stay theme-neutral
- Pick themes whose accent already lands somewhere these devices reproduce well (warm/saturated accents tend to translate better than narrow blues)

### I want to test my edits without a real device

You can dry-run without firing the request:

```bash
RICEKIT_DRY_RUN=1 ricekit apply tokyo-night
```

The integration will appear in the apply output as a `dry-run` line so you can verify it would have fired, without any HTTP call leaving the machine.

---

## Where things live

| Path | What it is |
| --- | --- |
| `~/.config/ricekit/integrations/` | Bundled integrations, extracted on first run |
| `~/.config/ricekit/installed-integrations/` | Integrations from the community release tarball |
| `~/.config/ricekit/custom-integrations/` | Your own un-published integrations (never overwritten) |
| `~/.config/ricekit/state.toml` | `[[active_configs]]` entries with `kind = "integration"` |
| `~/.config/ricekit/rendered/` | Last rendered request body (with `@@secret:…@@` markers, **never** real secret values) |
| macOS Keychain | Secret values, stored as `ricekit.<integration>.<key>` items under your login keychain |

---

## Authoring a new integration

If you want to ship a new integration (Hue, LIFX, Nanoleaf, Home Assistant, a custom webhook, etc.), see the **"Contributing an integration"** section in the repo-root [CONTRIBUTING.md](../CONTRIBUTING.md). The Govee integration in this directory is the canonical reference — clone its layout (`integration.toml` + `body/payload.json.tmpl`) and adapt the manifest to your endpoint.
