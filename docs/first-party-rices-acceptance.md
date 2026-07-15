# First-party Rices acceptance

This gate applies to the initial first-party set: `flexoki-paper`,
`kanagawa-wave`, and `osaka-jade-night`. Do not publish their content release
or mark the community pull request ready until every required row has attached
evidence.

## Test targets

Run the matrix on disposable, stock macOS installations:

1. macOS 11 Big Sur, the oldest version supported by the tested RiceKit build,
   at its latest available point release. The release operator must provide a
   snapshot-restored Intel Mac, self-hosted runner, or external Mac provider;
   Apple Virtualization Framework guests on the current Apple Silicon host do
   not provide this target.
2. The current production macOS release at the time of testing, using a
   disposable Apple Silicon VM or a snapshot-restored physical Mac.

Use a fresh VM snapshot or a fresh local account for each Rice. Do not reuse a
mutated account between Rices. Do not sign the account into personal services,
and do not capture account names, file contents, terminal history, or secrets.

## Pin the inputs

Record these values in the evidence bundle before applying anything:

```bash
sw_vers
uname -m
shasum -a 256 RiceKit_<version>_universal.dmg
shasum -a 256 ricekit-content-v2.YYYYMMDD.N.tar.gz
git -C ricekit rev-parse HEAD
git -C ricekit-community rev-parse HEAD
```

Also record the VM template and pristine snapshot identifiers. Hash the DMG or
other complete distribution artifact used to install the app, not only one
Mach-O inside the bundle; wallpaper application depends on bundled resources.

Build the content archive only with `scripts/release_content.py`. Verify its
generated `.sha256` before seeding it into the disposable account. Until the
content release is public, extract the verified archive into
`~/.config/ricekit/community-cache/v<version>/`, point the cache's `current`
symlink at that directory, and write a current RFC 3339 timestamp to
`community-cache/.last-checked`. This is test setup only; users must receive
the content through RiceKit's verified marketplace refresh.

## Clean-account preflight

Before installing RiceKit, attach machine-readable output proving:

- `~/.config/ricekit` does not exist;
- the VM/template and pristine snapshot identifiers match the matrix row;
- no `RiceKit` Terminal profile exists; and
- the baseline Terminal default/startup profile names, Appearance mode, and
  accent color have been recorded for later comparison.

After first launch but before Rice installation, capture the empty Rices
listing and prove that no marketplace-installed Rice, theme, or config exists.
First launch creates normal RiceKit directories and bundled content; that is
not pre-existing user state. After installing the Rice but before granting
consent, capture the first apply attempt showing both native consents as
required/`not_asked`. Pre-existing RiceKit state before first launch, installed
marketplace content before the test install, or already-settled native consent
fails the clean-account row; restore the pristine snapshot instead of deleting
individual files and continuing.

## Per-Rice procedure

For each Rice, restore the pristine snapshot and then:

1. Install the exact RiceKit build and seed the exact content archive.
2. Open Marketplace and install only the Rice under test.
3. Quit Terminal.app. Open Rices. Flexoki and Osaka must report `2/2`
   compatible. Kanagawa must report `2/3` compatible, with Appearance and
   Terminal ready and Ghostty identified as unavailable on a stock install.
4. Apply the Rice. Grant both the one-time Appearance consent and the separate
   Terminal-profile consent, enable **Make the RiceKit profile the default**,
   and wait for the structured result. No terminal command may be required.
5. Reopen Terminal.app and confirm the dedicated `RiceKit` profile is active.
6. Confirm the desktop wallpaper, macOS light/dark appearance and accent, and
   Terminal colors all visibly match the selected Rice.
7. Record and hash the Terminal ownership files under
   `~/.config/ricekit/setup/{receipts,backups}/.terminal-profiles/`. On a clean
   account, the first apply creates one receipt for `terminal-profile` and no
   profile backup because no prior `RiceKit` profile existed.
8. Apply the same Rice again with Terminal.app closed. Confirm success, stable
   ownership paths/counts, and no new backup. The receipt is transactionally
   rewritten, so its timestamp and whole-file hash may change; compare the
   invariant `owner_config`, `profile_name`, `origin`, `original_profile`,
   `epoch_default_before`, `epoch_startup_before`, and `backup` fields instead.
9. Run `ricekit config setup terminal-profile --restore --json`. Confirm RiceKit
   removes its dedicated profile and receipt and restores the baseline Terminal
   default/startup selectors. The current Configs UI does not expose this
   recipe-less native restore. RiceKit does not snapshot Appearance values, so
   restore those manually from the recorded baseline or destroy the disposable
   snapshot; do not claim an in-app Appearance restore.
10. Capture the final marketplace screenshot only after the clean apply passes,
    then restore or destroy the environment as specified above.

## Expected matrix

| Rice | Wallpaper | Appearance | Terminal.app | Stock-Mac result |
| --- | --- | --- | --- | --- |
| Flexoki Paper | warm orb | light, blue accent | Flexoki Light palette | card 2/2; apply 2 |
| Kanagawa Wave | Hokusai wave | dark, blue accent | Kanagawa palette | card 2/3; apply 2, Ghostty skipped |
| Osaka Jade Night | glowing city | dark, jade accent | Osaka Jade palette | card 2/2; apply 2 |

## Evidence bundle

Attach one directory per OS and Rice containing:

- `environment.txt` with OS/build/architecture, VM template/snapshot identity,
  and both repository commits;
- content archive and complete app distribution SHA256 values;
- clean-account preflight output proving absent pre-launch RiceKit state, no
  `RiceKit` Terminal profile, baseline native values, empty post-launch
  marketplace state, and the first Rice apply attempt requiring both consents;
- a before screenshot from the pristine account;
- an after screenshot showing the real wallpaper and reopened Terminal.app;
- an Appearance screenshot showing the applied mode and accent;
- install, first-apply, repeat-apply, and restore result JSON or redacted logs;
- sorted paths/counts beneath
  `setup/receipts/.terminal-profiles/` and
  `setup/backups/.terminal-profiles/` after first apply, repeat apply, and
  Terminal restore, plus a redacted comparison of the invariant receipt fields
  listed above; and
- reviewer name, date, and explicit pass/fail for every expected matrix cell.

Replace provisional previews in the Rice manifests with these
clean-account screenshots. A failure, missing screenshot, unpinned input, or
unrestored native setting keeps the release blocked. Remove
`rices/.publication-blocked` only in the reviewed change that adds the final
evidence-backed screenshots; the main-branch release workflow enforces that
marker.
