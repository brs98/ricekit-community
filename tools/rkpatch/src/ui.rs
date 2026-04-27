use colored::Colorize;
use std::path::Path;

pub fn header(title: &str) {
    println!();
    println!("  {}", title.bold().cyan());
    println!();
}

pub fn step(msg: &str) {
    println!("  {} {}", "›".cyan(), msg.dimmed());
}

pub fn done(msg: &str) {
    println!("  {} {}", "✓".green().bold(), msg);
}

pub fn done_final(msg: &str) {
    println!();
    println!("  {} {}", "✓".green().bold(), msg.bold());
    println!();
}

pub fn warn(msg: &str) {
    eprintln!("  {} {}", "!".yellow().bold(), msg.yellow());
}

pub fn kv(key: &str, value: &str) {
    println!("  {:<9} {}", format!("{}:", key).dimmed(), value);
}

pub fn kv_status(key: &str, installed: bool) {
    let value = if installed {
        "installed".green().bold().to_string()
    } else {
        "not installed".dimmed().to_string()
    };
    println!("  {:<9} {}", format!("{}:", key).dimmed(), value);
}

pub fn print_error(err: &anyhow::Error) {
    eprintln!();
    eprintln!("  {} {}", "✗".red().bold(), err.to_string().red().bold());
    let mut chain = err.chain().skip(1);
    if let Some(first) = chain.next() {
        eprintln!("    {} {}", "Cause:".dimmed(), first);
        for cause in chain {
            eprintln!("    {} {}", "       ".dimmed(), cause);
        }
    }
    eprintln!();
}

/// Compress an absolute path under `$HOME` to `~/...` for display.
pub fn display_path(p: &Path) -> String {
    let s = p.to_string_lossy();
    if let Some(home) = dirs::home_dir() {
        let home_s = home.to_string_lossy();
        if let Some(rest) = s.strip_prefix(home_s.as_ref()) {
            return format!("~{}", rest);
        }
    }
    s.into_owned()
}
