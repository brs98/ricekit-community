//! Thin CLI wrapper around the [`ricekit_validate`] library.
//!
//! Takes a single path argument, auto-detects whether it's a theme directory
//! (contains `theme.toml`) or a config directory (contains `config.toml`),
//! runs the corresponding validator, and prints the result.
//!
//! Exit codes:
//! - 0 — validation passed
//! - 1 — validation errors
//! - 2 — usage error (path doesn't exist, ambiguous, etc.)

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

use ricekit_validate::{validate_config_dir, validate_theme_dir};

#[derive(Parser)]
#[command(
    name = "ricekit-validate",
    about = "Schema validator for Ricekit themes and config templates",
    version
)]
struct Args {
    /// Path to the theme or config directory to validate
    path: PathBuf,
}

fn main() -> ExitCode {
    let args = Args::parse();

    if !args.path.exists() {
        eprintln!("error: path does not exist: {}", args.path.display());
        return ExitCode::from(2);
    }
    if !args.path.is_dir() {
        eprintln!("error: not a directory: {}", args.path.display());
        return ExitCode::from(2);
    }

    let has_theme_toml = args.path.join("theme.toml").exists();
    let has_config_toml = args.path.join("config.toml").exists();

    let report = match (has_theme_toml, has_config_toml) {
        (true, false) => validate_theme_dir(&args.path),
        (false, true) => validate_config_dir(&args.path),
        (true, true) => {
            eprintln!(
                "error: directory contains both theme.toml and config.toml — ambiguous: {}",
                args.path.display()
            );
            return ExitCode::from(2);
        }
        (false, false) => {
            eprintln!(
                "error: no theme.toml or config.toml found in: {}",
                args.path.display()
            );
            return ExitCode::from(2);
        }
    };

    let report = match report {
        Ok(r) => r,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::from(2);
        }
    };

    if report.is_ok() {
        println!("OK ({}): {}", report.kind, args.path.display());
        ExitCode::SUCCESS
    } else {
        eprintln!(
            "FAIL ({}): {} ({} error{})",
            report.kind,
            args.path.display(),
            report.errors.len(),
            if report.errors.len() == 1 { "" } else { "s" }
        );
        for err in &report.errors {
            eprintln!("  - {err}");
        }
        ExitCode::from(1)
    }
}
