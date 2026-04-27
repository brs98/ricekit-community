// OS-specific glue. Each submodule exposes the same set of free functions; the
// re-export below picks one at compile time so the rest of the crate calls
// `platform::app_version(cfg)` without caring which OS it's on.
//
// Both submodules compile on every host so a `cargo build` on macOS still
// type-checks the Linux module (and vice versa). The `cfg(target_os)` gate
// only chooses which one's symbols are publicly re-exported.
//
// Adding a new OS = a new sibling module exposing the same surface, plus a
// `cfg` arm here.

#[allow(dead_code)]
mod macos;
#[allow(dead_code)]
mod linux;

#[cfg(target_os = "macos")]
pub use macos::*;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
compile_error!("rkpatch supports macOS and Linux only.");
