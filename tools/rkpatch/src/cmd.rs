use crate::asar;
use crate::config::{AppConfig, Encode};
use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const BEGIN: &str = "/* ricekit-electron-css-injection:BEGIN */";
const END: &str = "/* ricekit-electron-css-injection:END */";

pub fn status(cfg: &AppConfig) -> Result<()> {
    let (rel, abs) = pick_asar(cfg)?;
    let header = asar::read_header(&abs)?;
    let main = main_entry(&abs, &header)?;
    let main_src = String::from_utf8(asar::read_file_from_archive(&abs, &header, &main)?)?;
    let patched = main_src.contains(BEGIN) && main_src.contains(END);
    let bak = backup_dir(cfg)?;
    let backup_state = if bak.join("app.asar.bak").exists() {
        bak.display().to_string()
    } else {
        "(none)".to_string()
    };

    println!("app:     {}", cfg.app_path.display());
    println!("version: {}", app_version(cfg)?);
    println!("asar:    {}", rel);
    println!("main:    {}", main);
    println!("patched: {}", patched);
    println!("backup:  {}", backup_state);
    Ok(())
}

pub fn install(cfg: &AppConfig) -> Result<()> {
    let app_name = app_display_name(&cfg.app_path)?;
    let was_running = is_app_running(&app_name);
    if was_running {
        println!("quitting {} before patching…", app_name);
        quit_and_wait(&app_name)?;
    }

    // Run the actual install steps in a closure so that, no matter how they
    // fail, we still relaunch the app if it was running before. Otherwise a
    // mid-install error (e.g. missing sudo) would leave the user with the app
    // closed and no obvious next step.
    let result = install_inner(cfg);

    if was_running {
        if let Err(e) = launch_app(&app_name) {
            eprintln!("warning: failed to relaunch {}: {:#}", app_name, e);
        }
    }
    result
}

fn install_inner(cfg: &AppConfig) -> Result<()> {
    let (rel, abs) = pick_asar(cfg)?;
    let header = asar::read_header(&abs)?;
    let main = main_entry(&abs, &header)?;

    let bak = backup_dir(cfg)?;
    fs::create_dir_all(&bak)?;
    let bak_asar = bak.join("app.asar.bak");
    if !bak_asar.exists() {
        fs::copy(&abs, &bak_asar).with_context(|| {
            format!("backing up {} → {}", abs.display(), bak_asar.display())
        })?;
    }
    let info_plist = cfg.app_path.join("Contents/Info.plist");
    let bak_plist = bak.join("Info.plist.bak");
    if !bak_plist.exists() {
        fs::copy(&info_plist, &bak_plist)?;
    }

    // Read the current main entry's bytes straight from the archive, splice the
    // ricekit payload in, then surgically rewrite just that one file. We avoid
    // a full extract → repack because that path drops `unpacked: true` entries
    // (the .node native modules under `<archive>.unpacked/`), leaving the app
    // unable to load native modules at startup.
    let original_bytes = asar::read_file_from_archive(&abs, &header, &main)?;
    let original = String::from_utf8(original_bytes)
        .with_context(|| format!("`{}` is not valid UTF-8", main))?;
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
    codesign_adhoc(cfg)?;

    println!("installed ricekit injection into {}", rel);
    Ok(())
}

pub fn restore(cfg: &AppConfig) -> Result<()> {
    let bak = backup_dir(cfg)?;
    let (_, abs) = pick_asar(cfg)?;
    let bak_asar = bak.join("app.asar.bak");
    if !bak_asar.exists() {
        return Err(anyhow!("no backup at {}", bak.display()));
    }
    fs::copy(&bak_asar, &abs)?;
    let info_plist = cfg.app_path.join("Contents/Info.plist");
    fs::copy(bak.join("Info.plist.bak"), &info_plist)?;
    codesign_adhoc(cfg)?;
    println!(
        "restored {} from {}",
        cfg.app_path.display(),
        bak.display()
    );
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
        "no ASAR found under {} (tried: {})",
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
    let home = dirs::home_dir().ok_or_else(|| anyhow!("could not resolve home directory"))?;
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
        .ok_or_else(|| anyhow!("`main` not set in package.json"))?;
    Ok(main.trim_start_matches("./").to_string())
}

fn build_payload(cfg: &AppConfig) -> Result<String> {
    let inject_path = cfg.inject_path();
    let mut payload = fs::read_to_string(&inject_path)
        .with_context(|| format!("reading inject payload {}", inject_path.display()))?;
    for sub in &cfg.substitutions {
        if !payload.contains(&sub.placeholder) {
            return Err(anyhow!(
                "{} is missing placeholder `{}`",
                inject_path.display(),
                sub.placeholder
            ));
        }
        let from_path = cfg.substitution_path(sub);
        let raw = fs::read_to_string(&from_path)
            .with_context(|| format!("reading substitution source {}", from_path.display()))?;
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
        .ok_or_else(|| anyhow!("could not derive app name from {}", app_path.display()))
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
                "{} did not quit within 15s — close it manually and retry",
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
        return Err(anyhow!("`open -a {}` exited with {}", app_name, status));
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
        .with_context(|| format!("spawning `{}`", cmd))?;
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
                "{} {}: permission denied. Retry with sudo.\n{}",
                cmd,
                args.join(" "),
                detail
            ));
        }
        return Err(anyhow!("{} {}: {}", cmd, args.join(" "), detail));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
