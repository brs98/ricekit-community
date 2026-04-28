// macOS implementation of the platform surface used by `cmd.rs`.
//
// The integrity manifest lives in the app's `Contents/Info.plist`, which is
// also why we back it up alongside the asar. Re-signing is required because
// editing the asar invalidates the bundle's existing signature.
//
// macOS Sequoia (15) and later: AMFI's launch-provenance policy refuses
// in-place writes to files inside an Apple-notarized, launched bundle in
// `/Applications/`. Even root gets EPERM; even removing the
// `com.apple.provenance` xattr is blocked. The escape hatch is a fresh-inode
// copy of the bundle: `cp -R` produces inodes AMFI doesn't track, so writes
// to the copy succeed. Once we ad-hoc resign the copy and swap it into
// place, the new bundle is no longer Apple-notarized, AMFI no longer
// engages, and subsequent rkpatch runs can mutate it in place.
//
// `run_writes` below picks the path: probe the asar with an
// open-for-write; on EPERM, relocate to a same-volume staging dir, run the
// caller's mutations against a cfg pointing there, then atomic-swap the
// modified bundle into the original location.

use crate::asar;
use crate::config::AppConfig;
use anyhow::{anyhow, Context, Result};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
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

/// Run a closure that mutates the bundle. On macOS Sequoia 15+ where AMFI
/// blocks in-place writes to launched, Apple-notarized bundles, this
/// transparently relocates the bundle to a same-volume staging dir, runs the
/// closure against a cfg pointing there, then atomic-swaps the mutated copy
/// back into the original location.
///
/// On bundles that have already been ad-hoc resigned (i.e. patched once
/// before, by this tool or a predecessor like the old `patch.mjs`), AMFI
/// does not engage and the closure runs in place — no relocate needed.
pub fn run_writes<F, R>(cfg: &AppConfig, mutate: F) -> Result<R>
where
    F: FnOnce(&AppConfig) -> Result<R>,
{
    if writes_allowed_in_place(cfg)? {
        return mutate(cfg);
    }
    crate::ui::warn(
        "macOS is blocking in-place edits to this bundle (AMFI launch provenance). \
         Relocating it to staging — the bundle will be replaced atomically when done.",
    );
    relocate_and_mutate(cfg, mutate)
}

/// Probe whether writes to the bundle's asars are allowed in place. AMFI's
/// open policy denies `O_WRONLY` at open time on protected bundles, so a
/// zero-byte open-and-drop is enough to detect the block — nothing is
/// written.
fn writes_allowed_in_place(cfg: &AppConfig) -> Result<bool> {
    let asars = cfg.find_all_asars()?;
    let (_, probe_target) = asars
        .first()
        .ok_or_else(|| anyhow!("Couldn't find any asar to probe."))?;
    // POSIX: 1 = EPERM, 13 = EACCES. AMFI's launch-provenance policy returns
    // EPERM at open(2) on protected bundles; classic Unix permission failures
    // return EACCES. We only relocate for EPERM — EACCES means the user
    // needs sudo, which the relocate dance won't fix.
    const EPERM: i32 = 1;
    const EACCES: i32 = 13;
    match std::fs::OpenOptions::new()
        .write(true)
        .open(probe_target)
    {
        Ok(_) => Ok(true),
        Err(e) if e.raw_os_error() == Some(EPERM) => Ok(false),
        Err(e) if e.raw_os_error() == Some(EACCES) => Ok(true),
        Err(e) => Err(e).with_context(|| {
            format!(
                "Couldn't probe write access to {}.",
                probe_target.display()
            )
        }),
    }
}

fn relocate_and_mutate<F, R>(cfg: &AppConfig, mutate: F) -> Result<R>
where
    F: FnOnce(&AppConfig) -> Result<R>,
{
    let bundle_parent = cfg
        .app_path
        .parent()
        .ok_or_else(|| anyhow!("Bundle path {} has no parent.", cfg.app_path.display()))?
        .to_path_buf();
    let bundle_name = cfg
        .app_path
        .file_name()
        .ok_or_else(|| anyhow!("Bundle path {} has no file name.", cfg.app_path.display()))?
        .to_owned();
    let staging = staging_dir(&bundle_parent)?;
    // Always clean staging on exit (success OR failure) so we don't leak the
    // copy or the moved-aside original.
    let guard = StagingGuard {
        path: staging.clone(),
    };
    let staged_bundle = staging.join(&bundle_name);
    let aside_name = {
        let mut n: OsString = bundle_name.clone();
        n.push(".rkpatch-original");
        n
    };
    let aside_bundle = staging.join(&aside_name);

    crate::ui::step("Copying the bundle to staging");
    cp_recursive(&cfg.app_path, &staged_bundle)?;
    crate::ui::done("Copied the bundle to staging");

    let staged_cfg = AppConfig {
        app_path: staged_bundle.clone(),
        ..cfg.clone()
    };

    let result = mutate(&staged_cfg)?;

    crate::ui::step("Swapping the patched bundle into place");
    // Atomic-ish: rename original aside (succeeds — AMFI allows renaming the
    // bundle root, just not modifying contents), then rename modified copy
    // into the canonical path. Both renames are same-volume, so each is a
    // single rename(2) syscall.
    std::fs::rename(&cfg.app_path, &aside_bundle).with_context(|| {
        format!(
            "Couldn't move the original bundle aside to {}.",
            aside_bundle.display()
        )
    })?;
    if let Err(e) = std::fs::rename(&staged_bundle, &cfg.app_path) {
        // Try to put the original back so the user isn't left with no app.
        let _ = std::fs::rename(&aside_bundle, &cfg.app_path);
        return Err(e).with_context(|| {
            format!(
                "Couldn't move the patched bundle into {}. Original restored from staging.",
                cfg.app_path.display()
            )
        });
    }
    crate::ui::done("Swapped the patched bundle into place");

    drop(guard);
    Ok(result)
}

/// Pick a hidden staging directory next to the bundle, on the same volume so
/// rename(2) stays atomic. We include the pid so concurrent rkpatch runs
/// against different apps don't collide.
fn staging_dir(parent: &Path) -> Result<PathBuf> {
    let dir = parent.join(format!(".rkpatch-staging-{}", std::process::id()));
    if dir.exists() {
        std::fs::remove_dir_all(&dir).with_context(|| {
            format!("Couldn't clear stale staging dir at {}.", dir.display())
        })?;
    }
    std::fs::create_dir(&dir)
        .with_context(|| format!("Couldn't create staging dir at {}.", dir.display()))?;
    Ok(dir)
}

struct StagingGuard {
    path: PathBuf,
}

impl Drop for StagingGuard {
    fn drop(&mut self) {
        // Best-effort cleanup. If something inside is still in use the rm
        // will fail; that's fine — staging dirs are pid-scoped so leftovers
        // get cleaned on the next run with the same pid (extremely unlikely)
        // or are easy to spot for manual cleanup (`.rkpatch-staging-*`).
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Copy a directory tree using the system `cp -R`. We shell out rather than
/// implement directory walking ourselves so symlinks, executable bits,
/// extended attributes, and resource forks all come along verbatim — same
/// as a Finder-level duplicate. The `-c` flag asks APFS for clonefile-based
/// copy, so the operation is near-instant and consumes no extra space until
/// COW.
fn cp_recursive(src: &Path, dest: &Path) -> Result<()> {
    let status = Command::new("cp")
        .args(["-Rc"])
        .arg(src)
        .arg(dest)
        .status()
        .with_context(|| format!("Couldn't run `cp` to stage {}.", src.display()))?;
    if !status.success() {
        return Err(anyhow!(
            "`cp -Rc {} {}` failed (exit {}).",
            src.display(),
            dest.display(),
            status
        ));
    }
    Ok(())
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

