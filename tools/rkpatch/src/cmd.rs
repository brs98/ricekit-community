use crate::asar;
use crate::config::{AppConfig, Encode};
use crate::platform;
use crate::ui;
use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

const BEGIN: &str = "/* ricekit-electron-css-injection:BEGIN */";
const END: &str = "/* ricekit-electron-css-injection:END */";

pub fn status(cfg: &AppConfig) -> Result<()> {
    let asars = cfg.find_all_asars()?;
    // Multi-asar bundles (e.g. Slack arm64 + x64) are only fully patched when
    // every asar carries the markers. Reporting "installed" off the first one
    // would lie when only one slice was patched.
    let mut all_patched = true;
    for (_, abs) in &asars {
        let header = asar::read_header(abs)?;
        let main = main_entry(abs, &header)?;
        let main_src = String::from_utf8(asar::read_file_from_archive(abs, &header, &main)?)?;
        if !main_src.contains(BEGIN) || !main_src.contains(END) {
            all_patched = false;
            break;
        }
    }
    let bak = backup_dir(cfg)?;
    let any_backup = asars
        .iter()
        .any(|(rel, _)| bak.join(backup_name_for(rel)).exists());
    let backup_state = if any_backup {
        ui::display_path(&bak)
    } else {
        "none yet".to_string()
    };

    let app_name = platform::display_name(cfg)?;
    let version = platform::app_version(cfg)?;
    ui::header(&format!("{} v{}", app_name, version));
    ui::kv_status("Theme", all_patched);
    ui::kv("App", &ui::display_path(&cfg.app_path));
    ui::kv("Backup", &backup_state);
    println!();
    Ok(())
}

pub fn install(cfg: &AppConfig) -> Result<()> {
    let app_name = platform::display_name(cfg)?;
    let version = platform::app_version(cfg)?;
    ui::header(&format!("Installing Ricekit into {} v{}", app_name, version));

    let was_running = platform::is_running(cfg);
    if was_running {
        ui::step(&format!("Closing {}", app_name));
        platform::quit_and_wait(cfg)?;
        ui::done(&format!("Closed {}", app_name));
    }

    // Run the install steps in an inner function so that, no matter how they
    // fail, we still relaunch the app if it was running before. Otherwise a
    // mid-install error (e.g. missing sudo) would leave the user with the app
    // closed and no obvious next step.
    let result = install_inner(cfg, &app_name);

    if was_running {
        ui::step(&format!("Reopening {}", app_name));
        match platform::launch(cfg) {
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
    let asars = cfg.find_all_asars()?;

    ui::step(&format!("Backing up the original {}", app_name));
    let bak = backup_dir(cfg)?;
    fs::create_dir_all(&bak)?;
    let mut backup_was_fresh = false;
    for (rel, abs) in &asars {
        let bak_path = bak.join(backup_name_for(rel));
        if !bak_path.exists() {
            fs::copy(abs, &bak_path).with_context(|| {
                format!("Couldn't back up {} to {}.", abs.display(), bak_path.display())
            })?;
            backup_was_fresh = true;
        }
    }
    for (src, name) in platform::extra_backup_files(cfg) {
        let dest = bak.join(name);
        if !dest.exists() {
            fs::copy(&src, &dest).with_context(|| {
                format!("Couldn't back up {} to {}.", src.display(), dest.display())
            })?;
            backup_was_fresh = true;
        }
    }
    if backup_was_fresh {
        ui::done(&format!("Backed up the original {}", app_name));
    } else {
        ui::done(&format!("Reusing existing backup of {}", app_name));
    }

    // Read each asar's main entry straight from the archive, splice the
    // Ricekit payload in, then surgically rewrite just that one file. We avoid
    // a full extract → repack because that path drops `unpacked: true` entries
    // (the .node native modules under `<archive>.unpacked/`), leaving the app
    // unable to load native modules at startup.
    //
    // Bundles that ship multiple asars (e.g. Slack's arm64 + x64) are patched
    // in lockstep so whichever slice Electron picks at launch ends up themed.
    ui::step("Applying Ricekit theme");
    let payload = build_payload(cfg)?;
    for (rel, abs) in &asars {
        let header = asar::read_header(abs)?;
        let main = main_entry(abs, &header)?;
        let original_bytes = asar::read_file_from_archive(abs, &header, &main)?;
        let original = String::from_utf8(original_bytes)
            .with_context(|| format!("The app's main file `{}` isn't valid UTF-8.", main))?;
        let stripped = strip_existing(original);

        let mut next = stripped;
        next.push('\n');
        next.push_str(&payload);
        next.push('\n');

        asar::replace_file(abs, &main, next.as_bytes())?;

        let new_header = asar::read_header(abs)?;
        let integrity = asar::compute_integrity(abs, &new_header)?;
        platform::write_integrity(cfg, rel, &integrity)?;
    }
    ui::done("Applied Ricekit theme");

    if platform::REQUIRES_RE_SIGN {
        ui::step(&format!("Re-signing {}", app_name));
        platform::re_sign(cfg)?;
        ui::done(&format!("Re-signed {}", app_name));
    }
    Ok(())
}

pub fn restore(cfg: &AppConfig) -> Result<()> {
    let app_name = platform::display_name(cfg)?;
    let version = platform::app_version(cfg)?;
    ui::header(&format!("Restoring {} v{} to default", app_name, version));

    let was_running = platform::is_running(cfg);
    if was_running {
        ui::step(&format!("Closing {}", app_name));
        platform::quit_and_wait(cfg)?;
        ui::done(&format!("Closed {}", app_name));
    }

    let result = restore_inner(cfg, &app_name);

    if was_running {
        ui::step(&format!("Reopening {}", app_name));
        match platform::launch(cfg) {
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
    let asars = cfg.find_all_asars()?;
    let pairs: Vec<(PathBuf, PathBuf)> = asars
        .iter()
        .map(|(rel, abs)| (abs.clone(), bak.join(backup_name_for(rel))))
        .collect();
    if pairs.iter().all(|(_, b)| !b.exists()) {
        return Err(anyhow!(
            "No backup found at {}. There's nothing to restore.",
            ui::display_path(&bak)
        ));
    }
    ui::step(&format!("Restoring the original {}", app_name));
    for (abs, bak_path) in &pairs {
        if bak_path.exists() {
            fs::copy(bak_path, abs).with_context(|| {
                format!("Couldn't restore {} from {}.", abs.display(), bak_path.display())
            })?;
        } else {
            ui::warn(&format!(
                "No backup for {}; leaving as-is.",
                ui::display_path(abs)
            ));
        }
    }
    for (src, name) in platform::extra_backup_files(cfg) {
        let from = bak.join(name);
        fs::copy(&from, &src).with_context(|| {
            format!("Couldn't restore {} from {}.", src.display(), from.display())
        })?;
    }
    ui::done(&format!("Restored the original {}", app_name));

    if platform::REQUIRES_RE_SIGN {
        ui::step(&format!("Re-signing {}", app_name));
        platform::re_sign(cfg)?;
        ui::done(&format!("Re-signed {}", app_name));
    }
    Ok(())
}

fn backup_name_for(rel: &str) -> String {
    // Use the asar's basename so e.g. `Contents/Resources/app-arm64.asar`
    // backs up to `app-arm64.asar.bak`. Single-asar configs (Linear's
    // `app.asar`) keep the historical `app.asar.bak` name unchanged.
    let base = std::path::Path::new(rel)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(rel);
    format!("{}.bak", base)
}

fn backup_dir(cfg: &AppConfig) -> Result<PathBuf> {
    Ok(bundle_backup_root(cfg)?.join(platform::app_version(cfg)?))
}

fn bundle_backup_root(cfg: &AppConfig) -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("Couldn't find your home directory."))?;
    Ok(home
        .join(".config/ricekit/backups/electron-apps")
        .join(&cfg.bundle_id))
}

pub fn prune(cfg: &AppConfig) -> Result<()> {
    let app_name = platform::display_name(cfg)?;
    let current = platform::app_version(cfg)?;
    ui::header(&format!("Pruning old backups of {} (keeping v{})", app_name, current));

    let root = bundle_backup_root(cfg)?;
    if !root.exists() {
        ui::done_final("No backups directory yet — nothing to prune.");
        return Ok(());
    }

    let mut removed = 0usize;
    let mut kept_current = false;
    for entry in fs::read_dir(&root)
        .with_context(|| format!("Couldn't list backups under {}.", root.display()))?
    {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            // Stray file in the bundle dir — leave it alone, only touch
            // version directories we recognize as our own.
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == current {
            kept_current = true;
            continue;
        }
        ui::step(&format!("Removing old backup v{}", name));
        fs::remove_dir_all(entry.path()).with_context(|| {
            format!("Couldn't remove {}.", entry.path().display())
        })?;
        removed += 1;
    }

    let summary = match (kept_current, removed) {
        (false, 0) => "Nothing to prune.".to_string(),
        (true, 0) => format!("Only the current v{} backup is present.", current),
        (false, n) => format!("Removed {} old backup(s). No backup for the current version.", n),
        (true, n) => format!("Removed {} old backup(s). Kept v{}.", n, current),
    };
    ui::done_final(&summary);
    Ok(())
}

fn main_entry(abs: &std::path::Path, header: &asar::Header) -> Result<String> {
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
        // Require exactly one occurrence so a stray match elsewhere in the
        // template (e.g. a docstring or a future helper that copies the
        // payload) can't silently inline the userscript twice.
        let count = payload.matches(&sub.placeholder).count();
        if count == 0 {
            return Err(anyhow!(
                "The injection template at {} is missing the `{}` placeholder.",
                inject_path.display(),
                sub.placeholder
            ));
        }
        if count > 1 {
            return Err(anyhow!(
                "The injection template at {} contains the `{}` placeholder {} times; expected exactly once.",
                inject_path.display(),
                sub.placeholder,
                count
            ));
        }
        let from_path = cfg.substitution_path(sub);
        let raw = fs::read_to_string(&from_path)
            .with_context(|| format!("Couldn't read substitution source at {}.", from_path.display()))?;
        let replacement = match sub.encode {
            Encode::Json => serde_json::to_string(&raw)?,
            Encode::Raw => raw,
        };
        payload = payload.replacen(&sub.placeholder, &replacement, 1);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AppConfig, Encode, Substitution};
    use std::path::PathBuf;

    fn fake_cfg(template_dir: PathBuf, app_path: PathBuf, subs: Vec<Substitution>) -> AppConfig {
        AppConfig {
            bundle_id: "test".into(),
            template: "test".into(),
            inject_file: PathBuf::from("inject.js"),
            substitutions: subs,
            template_dir,
            app_path,
            asar_candidates: vec![],
            linux: None,
        }
    }

    #[test]
    fn strip_existing_passes_through_when_no_markers() {
        let src = "console.log('hi');\n".to_string();
        assert_eq!(strip_existing(src.clone()), src);
    }

    #[test]
    fn strip_existing_removes_single_block_with_surrounding_newlines() {
        // strip_existing eats BOTH the newline immediately before BEGIN and the
        // one immediately after END, so the surrounding text joins. install
        // re-adds those newlines around the new payload, keeping the round-trip
        // idempotent.
        let src = format!("before\n{}payload{}\nafter", BEGIN, END);
        assert_eq!(strip_existing(src), "beforeafter");
    }

    #[test]
    fn strip_existing_removes_consecutive_blocks() {
        let src = format!(
            "head\n{}one{}\n{}two{}\ntail",
            BEGIN, END, BEGIN, END
        );
        assert_eq!(strip_existing(src), "headtail");
    }

    #[test]
    fn strip_existing_leaves_unterminated_begin_alone() {
        // No END after BEGIN: the loop breaks on the inner find and the source
        // is returned as-is rather than truncating to EOF.
        let src = format!("a\n{}orphan\nb", BEGIN);
        assert_eq!(strip_existing(src.clone()), src);
    }

    #[test]
    fn strip_existing_ignores_lone_end_marker() {
        // END without BEGIN never satisfies the outer find — nothing happens.
        let src = format!("a {} b", END);
        assert_eq!(strip_existing(src.clone()), src);
    }

    #[test]
    fn strip_existing_is_idempotent() {
        let src = format!("x\n{}p{}\ny", BEGIN, END);
        let once = strip_existing(src);
        let twice = strip_existing(once.clone());
        assert_eq!(once, twice);
    }

    #[test]
    fn build_payload_substitutes_json_encoded() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("inject.js"), "const T = __PLACEHOLDER__;").unwrap();
        std::fs::write(dir.path().join("theme.js"), "alert('x')\n\"quoted\"").unwrap();
        let cfg = fake_cfg(
            dir.path().to_path_buf(),
            dir.path().to_path_buf(),
            vec![Substitution {
                placeholder: "__PLACEHOLDER__".into(),
                file: PathBuf::from("theme.js"),
                encode: Encode::Json,
            }],
        );
        let payload = build_payload(&cfg).unwrap();
        // Json encode wraps in a string literal so the userscript is safe to
        // splice into JS source verbatim — quotes and newlines escape.
        assert_eq!(payload, r#"const T = "alert('x')\n\"quoted\"";"#);
    }

    #[test]
    fn build_payload_substitutes_raw_inline() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("inject.js"), "do(__P__);").unwrap();
        std::fs::write(dir.path().join("snippet.js"), "1+1").unwrap();
        let cfg = fake_cfg(
            dir.path().to_path_buf(),
            dir.path().to_path_buf(),
            vec![Substitution {
                placeholder: "__P__".into(),
                file: PathBuf::from("snippet.js"),
                encode: Encode::Raw,
            }],
        );
        assert_eq!(build_payload(&cfg).unwrap(), "do(1+1);");
    }

    #[test]
    fn build_payload_errors_when_placeholder_missing() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("inject.js"), "no placeholder here").unwrap();
        std::fs::write(dir.path().join("x.js"), "x").unwrap();
        let cfg = fake_cfg(
            dir.path().to_path_buf(),
            dir.path().to_path_buf(),
            vec![Substitution {
                placeholder: "__MISSING__".into(),
                file: PathBuf::from("x.js"),
                encode: Encode::Raw,
            }],
        );
        let err = build_payload(&cfg).unwrap_err().to_string();
        assert!(err.contains("missing"), "expected 'missing' in: {}", err);
        assert!(err.contains("__MISSING__"), "expected placeholder name in: {}", err);
    }

    #[test]
    fn build_payload_errors_when_placeholder_appears_more_than_once() {
        let dir = tempfile::tempdir().unwrap();
        // Two literal occurrences — exactly the failure mode #8 was about.
        std::fs::write(dir.path().join("inject.js"), "a __DUP__ b __DUP__ c").unwrap();
        std::fs::write(dir.path().join("x.js"), "x").unwrap();
        let cfg = fake_cfg(
            dir.path().to_path_buf(),
            dir.path().to_path_buf(),
            vec![Substitution {
                placeholder: "__DUP__".into(),
                file: PathBuf::from("x.js"),
                encode: Encode::Raw,
            }],
        );
        let err = build_payload(&cfg).unwrap_err().to_string();
        assert!(err.contains("__DUP__"), "expected placeholder name in: {}", err);
        assert!(err.contains("2 times") || err.contains("twice"), "expected count in: {}", err);
    }
}
