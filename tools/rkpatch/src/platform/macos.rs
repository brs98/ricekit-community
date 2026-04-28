// macOS implementation of the platform surface used by `cmd.rs`.
//
// The integrity manifest lives in the app's `Contents/Info.plist`, which is
// also why we back it up alongside the asar. Re-signing is required because
// editing the asar invalidates the bundle's existing signature.

use crate::asar;
use crate::config::AppConfig;
use anyhow::{anyhow, Context, Result};
use std::path::PathBuf;
use std::process::Command;

/// Whether to emit a "re-signing the app" step during install/restore.
/// macOS requires it because editing the asar invalidates the bundle signature.
pub const REQUIRES_RE_SIGN: bool = true;

pub fn app_version(cfg: &AppConfig) -> Result<String> {
    let info_plist = cfg.app_path.join("Contents/Info.plist");
    let out = run(
        "plutil",
        &[
            "-extract",
            "CFBundleShortVersionString",
            "raw",
            "-o",
            "-",
            &info_plist.to_string_lossy(),
        ],
    )?;
    Ok(out.trim().to_string())
}

pub fn display_name(cfg: &AppConfig) -> Result<String> {
    // `/Applications/Linear.app` → `Linear`. We use the bundle's user-facing
    // name (without `.app`) for AppleScript and `open -a`; both accept it.
    cfg.app_path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("Couldn't determine the app name from {}.", cfg.app_path.display()))
}

pub fn is_running(cfg: &AppConfig) -> bool {
    let Ok(name) = display_name(cfg) else { return false };
    let script = format!("application \"{}\" is running", escape_applescript(&name));
    let out = match Command::new("osascript").args(["-e", &script]).output() {
        Ok(o) if o.status.success() => o,
        _ => return false,
    };
    String::from_utf8_lossy(&out.stdout).trim() == "true"
}

pub fn quit_and_wait(cfg: &AppConfig) -> Result<()> {
    let name = display_name(cfg)?;
    let script = format!(
        "tell application \"{}\" to quit",
        escape_applescript(&name)
    );
    // Best-effort: ignore osascript errors (e.g. user denies Automation perms);
    // we still poll for exit and the install will fail clearly if the app
    // never closes.
    let _ = Command::new("osascript").args(["-e", &script]).output();

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    while is_running(cfg) {
        if std::time::Instant::now() >= deadline {
            return Err(anyhow!(
                "{} didn't close within 15 seconds. Please quit it manually and try again.",
                name
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    Ok(())
}

pub fn launch(cfg: &AppConfig) -> Result<()> {
    let name = display_name(cfg)?;
    let status = Command::new("open").args(["-a", &name]).status()?;
    if !status.success() {
        return Err(anyhow!("Couldn't open {} (exit status {}).", name, status));
    }
    Ok(())
}

pub fn write_integrity(
    cfg: &AppConfig,
    asar_rel: &str,
    integrity: &asar::Integrity,
) -> Result<()> {
    let plist_key_segment = asar_rel.trim_start_matches("Contents/");
    // plutil treats `.` in keypaths as a separator — escape literal dots so that
    // e.g. `Resources/app.asar` resolves as a single key, not nested keys.
    let escaped = plist_key_segment.replace('.', r"\.");
    let key = format!("ElectronAsarIntegrity.{}", escaped);
    let info_plist = cfg.app_path.join("Contents/Info.plist");
    let json_str = integrity.to_json().to_string();
    run(
        "plutil",
        &[
            "-replace",
            &key,
            "-json",
            &json_str,
            &info_plist.to_string_lossy(),
        ],
    )?;
    Ok(())
}

pub fn re_sign(cfg: &AppConfig) -> Result<()> {
    run(
        "codesign",
        &[
            "--force",
            "--deep",
            "--sign",
            "-",
            &cfg.app_path.to_string_lossy(),
        ],
    )?;
    Ok(())
}

/// Files outside the asar that must be backed up at install time and restored
/// on `restore`. Returned as `(absolute_source, backup_filename)` pairs.
pub fn extra_backup_files(cfg: &AppConfig) -> Vec<(PathBuf, &'static str)> {
    vec![(cfg.app_path.join("Contents/Info.plist"), "Info.plist.bak")]
}

fn escape_applescript(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn run(cmd: &str, args: &[&str]) -> Result<String> {
    let output = Command::new(cmd)
        .args(args)
        .output()
        .with_context(|| format!("Couldn't run `{}`.", cmd))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if !stderr.trim().is_empty() {
            stderr.into_owned()
        } else {
            stdout.into_owned()
        };
        if detail.contains("EACCES") || detail.contains("Operation not permitted") {
            return Err(anyhow!(
                "Permission denied. Please run this command again with sudo."
            ));
        }
        return Err(anyhow!("{} failed: {}", cmd, detail.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

