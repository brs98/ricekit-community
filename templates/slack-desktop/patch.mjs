#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---- app-specific constants ----
const APP_NAME = "slack";
const BUNDLE_ID = "com.tinyspeck.slackmacgap";
const APP_PATH = "/Applications/Slack.app";
const ASAR_CANDIDATES = [
  `Contents/Resources/app-${process.arch === "arm64" ? "arm64" : "x64"}.asar`,
];
// --------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const INFO_PLIST = join(APP_PATH, "Contents", "Info.plist");
const INJECTION_PATH = join(HERE, "ricekit-inject.js");
const BEGIN = "/* ricekit-electron-css-injection:BEGIN */";
const END = "/* ricekit-electron-css-injection:END */";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}\n${r.stderr || r.stdout}`);
  return r.stdout;
}

function asar(...args) { return run("npx", ["--yes", "@electron/asar@3.2.1", ...args]); }
function plutil(...args) { return run("plutil", args); }

function appVersion() {
  return plutil("-extract", "CFBundleShortVersionString", "raw", "-o", "-", INFO_PLIST).trim();
}

function pickAsar() {
  for (const rel of ASAR_CANDIDATES) {
    const abs = join(APP_PATH, rel);
    if (existsSync(abs)) return { rel, abs };
  }
  throw new Error(`no ASAR found under ${APP_PATH} (tried: ${ASAR_CANDIDATES.join(", ")})`);
}

function backupDir() {
  return join(homedir(), ".config", "ricekit", "backups", "electron-apps", BUNDLE_ID, appVersion());
}

function extractMainEntry(asarAbs) {
  const pkg = JSON.parse(asar("extract-file", asarAbs, "package.json"));
  return pkg.main.replace(/^\.\//, "");
}

function computeIntegrity(asarAbs) {
  const BLOCK = 4096;
  const info = JSON.parse(asar("header", asarAbs));
  const headerString = info.headerString;
  const hash = createHash("sha256").update(headerString).digest("hex");
  const buf = readFileSync(asarAbs);
  const contentStart = info.headerSize;
  const blocks = [];
  for (let off = contentStart; off < buf.length; off += BLOCK) {
    const slice = buf.subarray(off, Math.min(off + BLOCK, buf.length));
    blocks.push(createHash("sha256").update(slice).digest("hex"));
  }
  return { algorithm: "SHA256", hash, blockSize: BLOCK, blocks };
}

function writeIntegrity(asarRel, integrity) {
  const plistKey = asarRel.replace(/^Contents\//, "");
  const tmp = join("/tmp", `ricekit-integrity-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(integrity));
  plutil("-replace", `ElectronAsarIntegrity.${plistKey.replace(/\./g, "\\.")}`, "-json", JSON.stringify(integrity), INFO_PLIST);
  rmSync(tmp, { force: true });
}

function codesignAdhoc() {
  run("codesign", ["--force", "--deep", "--sign", "-", APP_PATH]);
}

function cmdStatus() {
  const { rel, abs } = pickAsar();
  const bak = backupDir();
  const main = extractMainEntry(abs);
  const mainSrc = asar("extract-file", abs, main);
  const patched = mainSrc.includes(BEGIN) && mainSrc.includes(END);
  console.log(`app:     ${APP_PATH}`);
  console.log(`version: ${appVersion()}`);
  console.log(`asar:    ${rel}`);
  console.log(`main:    ${main}`);
  console.log(`patched: ${patched}`);
  console.log(`backup:  ${existsSync(join(bak, "app.asar.bak")) ? bak : "(none)"}`);
}

function cmdInstall() {
  const { rel, abs } = pickAsar();
  const main = extractMainEntry(abs);
  const bak = backupDir();
  mkdirSync(bak, { recursive: true });
  if (!existsSync(join(bak, "app.asar.bak"))) copyFileSync(abs, join(bak, "app.asar.bak"));
  if (!existsSync(join(bak, "Info.plist.bak"))) copyFileSync(INFO_PLIST, join(bak, "Info.plist.bak"));

  const scratch = join("/tmp", `ricekit-${APP_NAME}-${Date.now()}`);
  asar("extract", abs, scratch);

  const mainAbs = join(scratch, main);
  let src = readFileSync(mainAbs, "utf8");
  src = src.replace(new RegExp(`\\n?${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}\\n?`, "g"), "");
  const payload = readFileSync(INJECTION_PATH, "utf8");
  writeFileSync(mainAbs, src + "\n" + payload + "\n");

  asar("pack", scratch, abs);
  rmSync(scratch, { recursive: true, force: true });

  writeIntegrity(rel, computeIntegrity(abs));
  codesignAdhoc();
  console.log(`installed ricekit injection into ${rel}`);
}

function cmdRestore() {
  const bak = backupDir();
  const { abs } = pickAsar();
  if (!existsSync(join(bak, "app.asar.bak"))) throw new Error(`no backup at ${bak}`);
  copyFileSync(join(bak, "app.asar.bak"), abs);
  copyFileSync(join(bak, "Info.plist.bak"), INFO_PLIST);
  codesignAdhoc();
  console.log(`restored ${APP_PATH} from ${bak}`);
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

const [, , cmd] = process.argv;
try {
  if (cmd === "status") cmdStatus();
  else if (cmd === "install") cmdInstall();
  else if (cmd === "restore") cmdRestore();
  else {
    console.error("usage: patch.mjs <status|install|restore>");
    process.exit(2);
  }
} catch (e) {
  if (e.message.includes("EACCES") || e.message.includes("Operation not permitted")) {
    console.error(`permission denied. Retry with: sudo node ${process.argv[1]} ${cmd}`);
  } else {
    console.error(e.message);
  }
  process.exit(1);
}
