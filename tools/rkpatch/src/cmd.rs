use crate::asar;
use crate::config::{AppConfig, Encode};
use crate::ui;
use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const BEGIN: &str = "/* ricekit-electron-css-injection:BEGIN */";
const END: &str = "/* ricekit-electron-css-injection:END */";

pub fn status(cfg: &AppConfig) -> Result<()> {
    let (_, abs) = pick_asar(cfg)?;
    let header = asar::read_header(&abs)?;
    let main = main_entry(&abs, &header)?;
    let main_src = String::from_utf8(asar::read_file_from_archive(&abs, &header, &main)?)?;
    let patched = main_src.contains(BEGIN) && main_src.contains(END);
    let bak = backup_dir(cfg)?;
    let backup_state = if bak.join("app.asar.bak").exists() {
        ui::display_path(&bak)
    } else {
        "none yet".to_string()
    };

    let app_name = app_display_name(&cfg.app_path)?;
    let version = app_version(cfg)?;
    ui::header(&format!("{} v{}", app_name, version));
    ui::kv_status("Theme", patched);
    ui::kv("App", &ui::display_path(&cfg.app_path));
    ui::kv("Backup", &backup_state);
    println!();
    Ok(())
}

pub fn install(cfg: &AppConfig) -> Result<()> {
    let app_name = app_display_name(&cfg.app_path)?;
    let version = app_version(cfg)?;
    ui::header(&format!("Installing Ricekit into {} v{}", app_name, version));

    let was_running = is_app_running(&app_name);
    if was_running {
        ui::step(&format!("Closing {}", app_name));
        quit_and_wait(&app_name)?;
        ui::done(&format!("Closed {}", app_name));
    }

    // Run the install steps in an inner function so that, no matter how they
    // fail, we still relaunch the app if it was running before. Otherwise a
    // mid-install error (e.g. missing sudo) would leave the user with the app
    // closed and no obvious next step.
    let result = install_inner(cfg, &app_name);

    if was_running {
        ui::step(&format!("Reopening {}", app_name));
        match launch_app(&app_name) {
            Ok(()) => ui::done(&format!("Reopened {}", app_name)),
            Err(e) => ui::warn(&format!(
                "Couldn't reopen {} automatically. Please open it yourself. ({:#})",
                app_name, e
            )),
        }
    }

    if result.is_ok() {
        ui::done_final(&format!("{} is ready with Ricekit applied.", app_name));
    }
    result
}

fn install_inner(cfg: &AppConfig, app_name: &str) -> Result<()> {
    let (rel, abs) = pick_asar(cfg)?;
    let header = asar::read_header(&abs)?;
    let main = main_entry(&abs, &header)?;

    ui::step(&format!("Backing up the original {}", app_name));
    let bak = backup_dir(cfg)?;
    fs::create_dir_all(&bak)?;
    let bak_asar = bak.join("app.asar.bak");
    let bak_plist = bak.join("Info.plist.bak");
    let info_plist = cfg.app_path.join("Contents/Info.plist");
    let mut backup_was_fresh = false;
    if !bak_asar.exists() {
        fs::copy(&abs, &bak_asar).with_context(|| {
            format!("Couldn't back up {} to {}.", abs.display(), bak_asar.display())
        })?;
        backup_was_fresh = true;
    }
    if !bak_plist.exists() {
        fs::copy(&info_plist, &bak_plist)?;
        backup_was_fresh = true;
    }
    if backup_was_fresh {
        ui::done(&format!("Backed up the original {}", app_name));
    } else {
        ui::done(&format!("Reusing existing backup of {}", app_name));
    }

    // Read the current main entry's bytes straight from the archive, splice the
    // Ricekit payload in, then surgically rewrite just that one file. We avoid
    // a full extract → repack because that path drops `unpacked: true` entries
    // (the .node native modules under `<archive>.unpacked/`), leaving the app
    // unable to load native modules at startup.
    ui::step("Applying Ricekit theme");
    let original_bytes = asar::read_file_from_archive(&abs, &header, &main)?;
    let original = String::from_utf8(original_bytes)
        .with_context(|| format!("The app's main file `{}` isn't valid UTF-8.", main))?;
    let stripped = strip_existing(original);

    let payload = build_payload(cfg)?;
    let mut next = stripped;
    next.push('\n');
    next.push_str(&payload);
    next.push('\n');

    asar::replace_file(&abs, &main, next.as_bytes())?;

    let new_header = asar::read_header(&abs)?;
    let integrity = asar::compute_integrity(&abs, &new_header)?;
    write_integrity(cfg, &rel, &integrity)?;
    ui::done("Applied Ricekit theme");

    ui::step(&format!("Re-signing {}", app_name));
    codesign_adhoc(cfg)?;
    ui::done(&format!("Re-signed {}", app_name));
    Ok(())
}

pub fn restore(cfg: &AppConfig) -> Result<()> {
    let app_name = app_display_name(&cfg.app_path)?;
    let version = app_version(cfg)?;
    ui::header(&format!("Restoring {} v{} to default", app_name, version));

    let was_running = is_app_running(&app_name);
    if was_running {
        ui::step(&format!("Closing {}", app_name));
        quit_and_wait(&app_name)?;
        ui::done(&format!("Closed {}", app_name));
    }

    let result = restore_inner(cfg, &app_name);

    if was_running {
        ui::step(&format!("Reopening {}", app_name));
        match launch_app(&app_name) {
            Ok(()) => ui::done(&format!("Reopened {}", app_name)),
            Err(e) => ui::warn(&format!(
                "Couldn't reopen {} automatically. Please open it yourself. ({:#})",
                app_name, e
            )),
        }
    }

    if result.is_ok() {
        ui::done_final(&format!("{} is back to its default look.", app_name));
    }
    result
}

fn restore_inner(cfg: &AppConfig, app_name: &str) -> Result<()> {
    let bak = backup_dir(cfg)?;
    let (_, abs) = pick_asar(cfg)?;
    let bak_asar = bak.join("app.asar.bak");
    if !bak_asar.exists() {
        return Err(anyhow!(
            "No backup found at {}. There's nothing to restore.",
            ui::display_path(&bak)
        ));
    }
    ui::step(&format!("Restoring the original {}", app_name));
    fs::copy(&bak_asar, &abs)?;
    let info_plist = cfg.app_path.join("Contents/Info.plist");
    fs::copy(bak.join("Info.plist.bak"), &info_plist)?;
    ui::done(&format!("Restored the original {}", app_name));

    ui::step(&format!("Re-signing {}", app_name));
    codesign_adhoc(cfg)?;
    ui::done(&format!("Re-signed {}", app_name));
    Ok(())
}

fn pick_asar(cfg: &AppConfig) -> Result<(String, PathBuf)> {
    for rel in &cfg.asar_candidates {
        let abs = cfg.app_path.join(rel);
        if abs.exists() {
            return Ok((rel.clone(), abs));
        }
    }
    Err(anyhow!(
        "Couldn't find the app's bundle inside {}. Tried: {}.",
        cfg.app_path.display(),
        cfg.asar_candidates.join(", ")
    ))
}

fn app_version(cfg: &AppConfig) -> Result<String> {
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

fn backup_dir(cfg: &AppConfig) -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("Couldn't find your home directory."))?;
    Ok(home
        .join(".config/ricekit/backups/electron-apps")
        .join(&cfg.bundle_id)
        .join(app_version(cfg)?))
}

fn main_entry(abs: &Path, header: &asar::Header) -> Result<String> {
    let pkg_bytes = asar::read_file_from_archive(abs, header, "package.json")?;
    let pkg: Value = serde_json::from_slice(&pkg_bytes)?;
    let main = pkg
        .get("main")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("The app's package.json is missing a `main` entry."))?;
    Ok(main.trim_start_matches("./").to_string())
}

fn build_payload(cfg: &AppConfig) -> Result<String> {
    let inject_path = cfg.inject_path();
    let mut payload = fs::read_to_string(&inject_path)
        .with_context(|| format!("Couldn't read injection template at {}.", inject_path.display()))?;
    for sub in &cfg.substitutions {
        if !payload.contains(&sub.placeholder) {
            return Err(anyhow!(
                "The injection template at {} is missing the `{}` placeholder.",
                inject_path.display(),
                sub.placeholder
            ));
        }
        let from_path = cfg.substitution_path(sub);
        let raw = fs::read_to_string(&from_path)
            .with_context(|| format!("Couldn't read substitution source at {}.", from_path.display()))?;
        let replacement = match sub.encode {
            Encode::Json => serde_json::to_string(&raw)?,
            Encode::Raw => raw,
        };
        payload = payload.replace(&sub.placeholder, &replacement);
    }
    Ok(payload)
}

fn strip_existing(mut src: String) -> String {
    loop {
        let Some(start) = src.find(BEGIN) else { break };
        let after_start = start + BEGIN.len();
        let Some(rel_end) = src[after_start..].find(END) else { break };
        let end = after_start + rel_end + END.len();
        let s = if start > 0 && src.as_bytes()[start - 1] == b'\n' {
            start - 1
        } else {
            start
        };
        let e = if end < src.len() && src.as_bytes()[end] == b'\n' {
            end + 1
        } else {
            end
        };
        src.replace_range(s..e, "");
    }
    src
}

fn write_integrity(cfg: &AppConfig, asar_rel: &str, integrity: &asar::Integrity) -> Result<()> {
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

fn codesign_adhoc(cfg: &AppConfig) -> Result<()> {
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

fn app_display_name(app_path: &Path) -> Result<String> {
    // `/Applications/Linear.app` → `Linear`. We use the bundle's user-facing
    // name (without `.app`) for AppleScript and `open -a`; both accept it.
    app_path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("Couldn't determine the app name from {}.", app_path.display()))
}

fn is_app_running(app_name: &str) -> bool {
    let script = format!("application \"{}\" is running", escape_applescript(app_name));
    let out = match Command::new("osascript").args(["-e", &script]).output() {
        Ok(o) if o.status.success() => o,
        _ => return false,
    };
    String::from_utf8_lossy(&out.stdout).trim() == "true"
}

fn quit_and_wait(app_name: &str) -> Result<()> {
    let script = format!(
        "tell application \"{}\" to quit",
        escape_applescript(app_name)
    );
    // Best-effort: ignore osascript errors (e.g. user denies Automation perms);
    // we still poll for exit and the install will fail clearly if the app
    // never closes.
    let _ = Command::new("osascript").args(["-e", &script]).output();

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    while is_app_running(app_name) {
        if std::time::Instant::now() >= deadline {
            return Err(anyhow!(
                "{} didn't close within 15 seconds. Please quit it manually and try again.",
                app_name
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    Ok(())
}

fn launch_app(app_name: &str) -> Result<()> {
    let status = Command::new("open").args(["-a", app_name]).status()?;
    if !status.success() {
        return Err(anyhow!("Couldn't open {} (exit status {}).", app_name, status));
    }
    Ok(())
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
