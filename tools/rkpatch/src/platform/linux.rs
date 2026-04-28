// Linux implementation of the platform surface used by `cmd.rs`.
//
// Notes on what's intentionally a no-op here:
//
// - **ASAR integrity manifest** — on macOS the manifest lives in
//   `Contents/Info.plist`. Linux Electron builds enforce ASAR integrity via the
//   `embeddedAsarIntegrityValidation` fuse compiled into the binary. There's no
//   portable, in-place way to keep the embedded hash table in sync with our
//   edited asar without patching the binary. Most upstream Linux Electron
//   builds ship with the fuse off, so the modified asar loads fine. If a build
//   does enforce it, the app will fail to launch — see the README for details.
//
// - **Re-signing** — Linux has no per-bundle signature analog to macOS's
//   ad-hoc codesign. AppImage/.deb/.rpm signatures live at the package level,
//   not the runtime bundle, and are checked by the package manager only, not
//   by the running Electron process.

use crate::asar;
use crate::config::AppConfig;
use anyhow::{anyhow, Context, Result};
use std::path::PathBuf;
use std::process::{Command, Stdio};

pub const REQUIRES_RE_SIGN: bool = false;

pub fn app_version(cfg: &AppConfig) -> Result<String> {
    // Linux Electron builds don't carry an Info.plist analog with a canonical
    // version string, so we read the version straight from the asar's
    // package.json. (The same field exists on macOS bundles too, but Info.plist
    // is the authoritative source there.)
    //
    // For multi-asar bundles all slices ship the same `version`, so the first
    // existing one is fine here.
    let asars = cfg.find_all_asars()?;
    let (_, abs) = &asars[0];
    let header = asar::read_header(abs)?;
    let pkg_bytes = asar::read_file_from_archive(abs, &header, "package.json")?;
    let pkg: serde_json::Value = serde_json::from_slice(&pkg_bytes)
        .context("Couldn't parse the app's package.json.")?;
    pkg.get("version")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("The app's package.json is missing a `version` field."))
}

pub fn display_name(cfg: &AppConfig) -> Result<String> {
    cfg.linux
        .as_ref()
        .map(|l| l.display_name.clone())
        .ok_or_else(|| anyhow!("Linux config is missing — was the [linux] section parsed?"))
}

pub fn is_running(cfg: &AppConfig) -> bool {
    let Some(linux) = cfg.linux.as_ref() else {
        return false;
    };
    // `pgrep -x` matches the executable name (comm) exactly. comm is truncated
    // to 15 chars on Linux; if a config ever needs a longer name we'd switch
    // to `pgrep -f` against the full command line, but for `slack`/`linear`
    // this is fine.
    Command::new("pgrep")
        .args(["-x", &linux.process_name])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn quit_and_wait(cfg: &AppConfig) -> Result<()> {
    let linux = cfg
        .linux
        .as_ref()
        .ok_or_else(|| anyhow!("Linux config missing for quit."))?;
    // Polite ask first.
    let _ = Command::new("pkill")
        .args(["-TERM", "-x", &linux.process_name])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    let start = std::time::Instant::now();
    let term_deadline = start + std::time::Duration::from_secs(10);
    let kill_deadline = start + std::time::Duration::from_secs(15);
    let mut sent_kill = false;
    while is_running(cfg) {
        let now = std::time::Instant::now();
        if !sent_kill && now >= term_deadline {
            // App ignored SIGTERM for 10s — escalate.
            let _ = Command::new("pkill")
                .args(["-KILL", "-x", &linux.process_name])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            sent_kill = true;
        }
        if now >= kill_deadline {
            return Err(anyhow!(
                "{} didn't close within 15 seconds. Please quit it manually and try again.",
                linux.display_name
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    Ok(())
}

pub fn launch(cfg: &AppConfig) -> Result<()> {
    let linux = cfg
        .linux
        .as_ref()
        .ok_or_else(|| anyhow!("Linux config missing for launch."))?;
    let (program, rest) = linux
        .launch_command
        .split_first()
        .ok_or_else(|| anyhow!("[linux] launch_command is empty."))?;
    // Spawn detached so the app survives rkpatch exiting. We never wait() on
    // this child — Electron will fork its own process tree on first launch.
    Command::new(program)
        .args(rest)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .with_context(|| format!("Couldn't start `{}`.", program))?;
    Ok(())
}

/// No-op on Linux. See module-level note for why.
pub fn write_integrity(
    _cfg: &AppConfig,
    _asar_rel: &str,
    _integrity: &asar::Integrity,
) -> Result<()> {
    Ok(())
}

/// No-op on Linux. See module-level note for why.
pub fn re_sign(_cfg: &AppConfig) -> Result<()> {
    Ok(())
}

pub fn extra_backup_files(_cfg: &AppConfig) -> Vec<(PathBuf, &'static str)> {
    Vec::new()
}

/// Linux has no AMFI analog — Electron bundles on disk are plain files
/// gated only by filesystem permissions, so writes either succeed in place
/// or fail with EACCES (telling the user to use sudo). No relocate needed.
pub fn run_writes<F, R>(cfg: &AppConfig, mutate: F) -> Result<R>
where
    F: FnOnce(&AppConfig) -> Result<R>,
{
    mutate(cfg)
}
