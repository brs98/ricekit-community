// Minimal asar reader/writer.
//
// asar archive layout (little-endian throughout):
//   [outer pickle: 4 bytes payload-size = 4][4 bytes header-pickle-size]
//   [header pickle: 4 bytes payload-size][4 bytes string-size][string bytes][padding to 4]
//   [content blob: raw concatenated file bytes addressed by offset/size in the header JSON]
//
// The header pickle's `string` is a JSON document describing a tree of files;
// each leaf has `size` (number) and `offset` (string of u64 bytes within the
// content blob). Directories nest under `files`.

use anyhow::{anyhow, Context, Result};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

/// Splice a single in-archive file's content without rebuilding the archive.
///
/// This preserves the original header tree byte-for-byte except for two edits:
/// the target file's `size` field, and the `offset` of every entry that lived
/// after the target in the content blob (shifted by the length delta). Crucially
/// it leaves `unpacked: true` entries — and their sibling `<archive>.unpacked/`
/// directory — completely alone, which a full extract → repack does not.
pub fn replace_file(archive: &Path, file_path: &str, new_content: &[u8]) -> Result<()> {
    let header = read_header(archive)?;
    let entry = lookup_entry(&header.root, file_path)
        .ok_or_else(|| anyhow!("not found in archive: {}", file_path))?;
    if entry.get("unpacked").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Err(anyhow!(
            "cannot replace `{}`: entry is unpacked (lives in .unpacked sibling)",
            file_path
        ));
    }
    let target_offset: u64 = entry
        .get("offset")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("entry has no offset: {}", file_path))?
        .parse()?;
    let target_size: u64 = entry
        .get("size")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| anyhow!("entry has no size: {}", file_path))?;

    let mut f = File::open(archive)?;
    f.seek(SeekFrom::Start(header.header_size))?;
    let mut content = Vec::new();
    f.read_to_end(&mut content)?;
    drop(f);

    let target_end = (target_offset + target_size) as usize;
    if target_end > content.len() {
        return Err(anyhow!(
            "target entry `{}` extends past content blob ({} > {})",
            file_path,
            target_end,
            content.len()
        ));
    }
    let mut new_content_blob =
        Vec::with_capacity(content.len() + new_content.len() - target_size as usize);
    new_content_blob.extend_from_slice(&content[..target_offset as usize]);
    new_content_blob.extend_from_slice(new_content);
    new_content_blob.extend_from_slice(&content[target_end..]);

    let new_size = new_content.len() as u64;
    let delta: i64 = new_size as i64 - target_size as i64;
    let mut new_root = header.root.clone();
    update_entry_size_and_integrity(&mut new_root, file_path, new_content)?;
    if delta != 0 {
        shift_offsets(&mut new_root, target_offset, delta);
    }

    let new_header_string = serde_json::to_string(&new_root)?;
    write_archive(archive, &new_header_string, &new_content_blob)?;
    Ok(())
}

fn update_entry_size_and_integrity(
    root: &mut Value,
    path: &str,
    new_content: &[u8],
) -> Result<()> {
    let mut cur = root;
    for seg in path.split('/').filter(|s| !s.is_empty()) {
        cur = cur
            .get_mut("files")
            .and_then(|v| v.get_mut(seg))
            .ok_or_else(|| anyhow!("missing path segment `{}` while updating entry", seg))?;
    }
    let obj = cur
        .as_object_mut()
        .ok_or_else(|| anyhow!("entry `{}` is not an object", path))?;
    obj.insert(
        "size".to_string(),
        Value::Number((new_content.len() as u64).into()),
    );

    // If this entry carries a per-file integrity block (Slack's archives do —
    // it's how Electron validates each file at read time), recompute it. The
    // block_size lives in the entry; both `hash` (over the whole content) and
    // `blocks` (chunked SHA256) must be regenerated from the new bytes or
    // launch fails with "ASAR Integrity Violation: got a hash mismatch".
    if let Some(integrity) = obj.get_mut("integrity").and_then(|v| v.as_object_mut()) {
        let algorithm = integrity
            .get("algorithm")
            .and_then(|v| v.as_str())
            .unwrap_or("SHA256");
        if algorithm != "SHA256" {
            return Err(anyhow!(
                "unsupported integrity algorithm `{}` on `{}`",
                algorithm,
                path
            ));
        }
        let block_size = integrity
            .get("blockSize")
            .and_then(|v| v.as_u64())
            .unwrap_or(4 * 1024 * 1024) as usize;
        let full_hash = sha256_hex(new_content);
        let blocks: Vec<Value> = new_content
            .chunks(block_size.max(1))
            .map(|chunk| Value::String(sha256_hex(chunk)))
            .collect();
        integrity.insert("hash".to_string(), Value::String(full_hash));
        integrity.insert("blocks".to_string(), Value::Array(blocks));
    }
    Ok(())
}

fn shift_offsets(node: &mut Value, threshold: u64, delta: i64) {
    if let Some(files) = node.get_mut("files").and_then(|v| v.as_object_mut()) {
        for (_, child) in files.iter_mut() {
            shift_offsets(child, threshold, delta);
        }
        return;
    }
    let Some(obj) = node.as_object_mut() else {
        return;
    };
    let Some(offset_str) = obj.get("offset").and_then(|v| v.as_str()) else {
        return;
    };
    let Ok(off) = offset_str.parse::<u64>() else {
        return;
    };
    if off > threshold {
        let new_off = (off as i64 + delta) as u64;
        obj.insert("offset".to_string(), Value::String(new_off.to_string()));
    }
}

pub struct Header {
    /// Raw header JSON exactly as read from disk — what integrity hashes.
    pub header_string: String,
    /// Byte offset where the content blob begins (= 8 + header pickle size).
    pub header_size: u64,
    /// Parsed header tree.
    pub root: Value,
}

pub fn read_header(path: &Path) -> Result<Header> {
    let mut f = File::open(path).with_context(|| format!("opening {}", path.display()))?;
    let mut size_buf = [0u8; 8];
    f.read_exact(&mut size_buf)?;
    let outer_payload_size = u32::from_le_bytes(size_buf[0..4].try_into().unwrap());
    if outer_payload_size != 4 {
        return Err(anyhow!(
            "unexpected asar outer pickle size: {}",
            outer_payload_size
        ));
    }
    let header_pickle_size = u32::from_le_bytes(size_buf[4..8].try_into().unwrap()) as usize;
    let mut hp = vec![0u8; header_pickle_size];
    f.read_exact(&mut hp)?;
    if hp.len() < 8 {
        return Err(anyhow!("asar header pickle too small"));
    }
    let _inner_payload = u32::from_le_bytes(hp[0..4].try_into().unwrap());
    let string_size = u32::from_le_bytes(hp[4..8].try_into().unwrap()) as usize;
    if 8 + string_size > hp.len() {
        return Err(anyhow!("asar header string size out of range"));
    }
    let header_string = std::str::from_utf8(&hp[8..8 + string_size])?.to_string();
    let root: Value = serde_json::from_str(&header_string)
        .context("parsing asar header JSON")?;
    Ok(Header {
        header_string,
        header_size: 8 + header_pickle_size as u64,
        root,
    })
}

pub fn read_file_from_archive(archive: &Path, header: &Header, file_path: &str) -> Result<Vec<u8>> {
    let entry = lookup_entry(&header.root, file_path)
        .ok_or_else(|| anyhow!("not found in archive: {}", file_path))?;
    let size = entry
        .get("size")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| anyhow!("entry has no size: {}", file_path))?;
    let offset_str = entry
        .get("offset")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("entry has no offset: {}", file_path))?;
    let offset: u64 = offset_str.parse()?;
    let mut f = File::open(archive)?;
    f.seek(SeekFrom::Start(header.header_size + offset))?;
    let mut buf = vec![0u8; size as usize];
    f.read_exact(&mut buf)?;
    Ok(buf)
}

fn lookup_entry<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = root;
    for seg in path.split('/').filter(|s| !s.is_empty()) {
        cur = cur.get("files")?.get(seg)?;
    }
    Some(cur)
}

pub fn extract_all(archive: &Path, dest: &Path) -> Result<()> {
    let header = read_header(archive)?;
    let mut f = File::open(archive)?;
    fs::create_dir_all(dest)?;
    extract_node(&mut f, &header, &header.root, dest)?;
    Ok(())
}

fn extract_node(f: &mut File, header: &Header, node: &Value, dest: &Path) -> Result<()> {
    if let Some(files) = node.get("files").and_then(|v| v.as_object()) {
        fs::create_dir_all(dest)?;
        for (name, child) in files {
            extract_node(f, header, child, &dest.join(name))?;
        }
        return Ok(());
    }
    if let Some(link) = node.get("link").and_then(|v| v.as_str()) {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(link, dest)?;
        return Ok(());
    }
    if let Some(offset_str) = node.get("offset").and_then(|v| v.as_str()) {
        let size = node
            .get("size")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| anyhow!("file node missing size"))?;
        let offset: u64 = offset_str.parse()?;
        f.seek(SeekFrom::Start(header.header_size + offset))?;
        let mut buf = vec![0u8; size as usize];
        f.read_exact(&mut buf)?;
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out = File::create(dest)?;
        out.write_all(&buf)?;
        if node
            .get("executable")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(dest, fs::Permissions::from_mode(0o755))?;
            }
        }
    }
    Ok(())
}

pub fn pack(src_dir: &Path, archive: &Path) -> Result<()> {
    let mut content: Vec<u8> = Vec::new();
    let root = build_dir(src_dir, &mut content)?;
    let header_string = serde_json::to_string(&root)?;
    write_archive(archive, &header_string, &content)?;
    Ok(())
}

fn build_dir(dir: &Path, content: &mut Vec<u8>) -> Result<Value> {
    let mut entries: Vec<_> = fs::read_dir(dir)?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    let mut files = Map::new();
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let ft = entry.file_type()?;
        let val = if ft.is_symlink() {
            let target = fs::read_link(&path)?;
            let mut node = Map::new();
            node.insert(
                "link".to_string(),
                Value::String(target.to_string_lossy().into_owned()),
            );
            Value::Object(node)
        } else if ft.is_dir() {
            build_dir(&path, content)?
        } else {
            let data = fs::read(&path)?;
            let offset = content.len() as u64;
            let size = data.len() as u64;
            content.extend_from_slice(&data);
            let mut node = Map::new();
            node.insert("size".to_string(), Value::Number(size.into()));
            node.insert("offset".to_string(), Value::String(offset.to_string()));
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = entry.metadata()?.permissions().mode();
                if mode & 0o111 != 0 {
                    node.insert("executable".to_string(), Value::Bool(true));
                }
            }
            Value::Object(node)
        };
        files.insert(name, val);
    }
    let mut node = Map::new();
    node.insert("files".to_string(), Value::Object(files));
    Ok(Value::Object(node))
}

/// Test-only entry point for assembling an asar with a hand-crafted header.
/// Production code should use `pack` instead — this is only exposed so
/// integration tests can build archives that mix in-archive and `unpacked`
/// entries (a shape `pack` can't produce on its own).
#[doc(hidden)]
pub fn write_archive_for_test(path: &Path, header_string: &str, content: &[u8]) -> Result<()> {
    write_archive(path, header_string, content)
}

fn write_archive(path: &Path, header_string: &str, content: &[u8]) -> Result<()> {
    let s = header_string.as_bytes();
    // Inner pickle payload: u32 string-size + string + padding to 4-byte alignment.
    let inner_unpadded = 4 + s.len();
    let inner_padded = (inner_unpadded + 3) & !3;
    let pad = inner_padded - inner_unpadded;

    let mut out = File::create(path)?;
    // Outer pickle: payload-size = 4, payload = the inner pickle's total length.
    out.write_all(&4u32.to_le_bytes())?;
    out.write_all(&((4 + inner_padded) as u32).to_le_bytes())?;
    // Inner pickle: payload-size, then payload (string-size + string + padding).
    out.write_all(&(inner_padded as u32).to_le_bytes())?;
    out.write_all(&(s.len() as u32).to_le_bytes())?;
    out.write_all(s)?;
    if pad > 0 {
        out.write_all(&vec![0u8; pad])?;
    }
    out.write_all(content)?;
    Ok(())
}

pub struct Integrity {
    pub algorithm: &'static str,
    pub hash: String,
    pub block_size: u32,
    pub blocks: Vec<String>,
}

impl Integrity {
    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "algorithm": self.algorithm,
            "hash": self.hash,
            "blockSize": self.block_size,
            "blocks": self.blocks,
        })
    }
}

pub fn compute_integrity(archive: &Path, header: &Header) -> Result<Integrity> {
    let header_hash = sha256_hex(header.header_string.as_bytes());
    let mut f = File::open(archive)?;
    f.seek(SeekFrom::Start(header.header_size))?;
    let mut blocks = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        blocks.push(sha256_hex(&buf[..n]));
    }
    Ok(Integrity {
        algorithm: "SHA256",
        hash: header_hash,
        block_size: 4096,
        blocks,
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    let h = Sha256::digest(bytes);
    let mut out = String::with_capacity(h.len() * 2);
    for b in h {
        use std::fmt::Write;
        let _ = write!(out, "{:02x}", b);
    }
    out
}
