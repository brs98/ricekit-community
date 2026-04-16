// Native messaging host for the Ricekit Userstyles addon.
//
// Browser spawns this on addon startup, keeps a stdio port open while the
// addon is alive. Protocol: 4-byte little-endian length prefix + JSON body.
//
// On startup we push an initial `vars_update`. We then watch ricekit's
// state.toml for any modification and re-push whenever the current theme
// changes. A short debounce coalesces the multiple writes ricekit emits on
// each apply.
//
// stderr is allowed and lands in Firefox's Browser Console tagged with the
// host name. stdout is reserved for the native-messaging protocol.

import { generateRootCss, parseRicekitThemeShow } from "./palette.ts";

const HOME = Deno.env.get("HOME") ?? "";
const STATE_FILE = `${HOME}/.config/ricekit/state.toml`;
const CONFIG_FILE = `${HOME}/.config/ricekit-userstyles/config.json`;

// Firefox spawns native hosts with a minimal PATH. `install.ts` resolves the
// full path to the ricekit binary and writes it to config.json so we can
// invoke it without relying on runtime PATH lookup.
async function readRicekitBin(): Promise<string> {
  try {
    const cfg = JSON.parse(await Deno.readTextFile(CONFIG_FILE));
    if (typeof cfg.ricekitBin === "string" && cfg.ricekitBin) {
      return cfg.ricekitBin;
    }
  } catch {
    // fall through to env var or bare name
  }
  return Deno.env.get("RICEKIT_BIN") ?? "ricekit";
}

const RICEKIT_BIN = await readRicekitBin();

// ---- native messaging protocol ---------------------------------------------

async function sendMessage(msg: unknown): Promise<void> {
  const payload = new TextEncoder().encode(JSON.stringify(msg));
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, payload.length, true);
  await Deno.stdout.write(lenBuf);
  await Deno.stdout.write(payload);
}

async function readMessage(): Promise<Record<string, unknown> | null> {
  const lenBuf = new Uint8Array(4);
  let read = 0;
  while (read < 4) {
    const n = await Deno.stdin.read(lenBuf.subarray(read));
    if (n === null) return null;
    read += n;
  }
  const len = new DataView(lenBuf.buffer).getUint32(0, true);
  if (len > 1_048_576) throw new Error(`message too large: ${len} bytes`);
  const payload = new Uint8Array(len);
  read = 0;
  while (read < len) {
    const n = await Deno.stdin.read(payload.subarray(read));
    if (n === null) return null;
    read += n;
  }
  return JSON.parse(new TextDecoder().decode(payload));
}

// Log to both stderr (harmless when invoked standalone, discarded by Firefox)
// AND to ~/.config/ricekit-userstyles/host.log — the log file is how we
// diagnose when Firefox is the parent and stderr goes nowhere.
const LOG_PATH = `${HOME}/.config/ricekit-userstyles/host.log`;
let logFile: Deno.FsFile | null = null;
try {
  logFile = await Deno.open(LOG_PATH, { create: true, append: true, write: true });
} catch {
  // log unavailable; stderr-only
}

function logStderr(msg: string): void {
  const line = `[${new Date().toISOString()}] [ricekit-userstyles] ${msg}\n`;
  const bytes = new TextEncoder().encode(line);
  Deno.stderr.write(bytes);
  if (logFile) {
    try {
      logFile.write(bytes);
    } catch {
      // best-effort
    }
  }
}

// ---- CSS generation --------------------------------------------------------

async function currentTheme(): Promise<string> {
  const text = await Deno.readTextFile(STATE_FILE);
  // state.toml shape: [current] section with `theme = "..."`. We grab the
  // `theme = "..."` that appears after the `[current]` header and before any
  // subsequent section.
  const section = text.match(/\[current\]\s*([\s\S]*?)(?:\n\[|$)/);
  if (!section) throw new Error("[current] section not found in state.toml");
  const themeLine = section[1].match(/^\s*theme\s*=\s*"([^"]+)"/m);
  if (!themeLine) {
    throw new Error("theme key not found under [current] in state.toml");
  }
  return themeLine[1];
}

async function generateCss(): Promise<string> {
  const theme = await currentTheme();
  const proc = new Deno.Command(RICEKIT_BIN, {
    args: ["theme", "show", theme],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await proc.output();
  if (code !== 0) {
    throw new Error(
      `ricekit theme show failed (${code}): ${new TextDecoder().decode(stderr)}`,
    );
  }
  const p = parseRicekitThemeShow(new TextDecoder().decode(stdout));
  return generateRootCss(p, `/* generated from ricekit theme "${theme}" */`);
}

async function pushVars(): Promise<void> {
  try {
    const css = await generateCss();
    await sendMessage({ type: "vars_update", css });
    logStderr(`pushed ${css.length} bytes`);
  } catch (e) {
    logStderr(`push failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---- main loop -------------------------------------------------------------

// Deno 2.x treats unhandled rejections as fatal — catch them so we can log
// and keep running. The browser keeps the host alive by the stdin pipe;
// we only exit when that pipe closes.
globalThis.addEventListener("unhandledrejection", (ev) => {
  ev.preventDefault();
  logStderr(
    `unhandledrejection: ${
      (ev.reason instanceof Error ? ev.reason.stack : String(ev.reason)) ?? ""
    }`,
  );
});

logStderr(`host starting (pid ${Deno.pid}, argv: ${Deno.args.join(" ")})`);

try {
  await pushVars();
} catch (e) {
  logStderr(`initial push error: ${e instanceof Error ? e.message : e}`);
}

// Debounced watcher on state.toml. Ricekit emits multiple writes per apply
// (state + per-config renders); 150ms coalesces them without adding perceptible
// lag.
let debounce: number | undefined;

(async () => {
  try {
    const watcher = Deno.watchFs(STATE_FILE);
    logStderr(`watching ${STATE_FILE}`);
    for await (const _event of watcher) {
      if (debounce !== undefined) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = undefined;
        pushVars();
      }, 150);
    }
  } catch (e) {
    logStderr(`watcher error: ${e instanceof Error ? e.message : e}`);
  }
})();

// Respond to explicit addon requests. stdin EOF means the addon disconnected
// — we exit cleanly so the next connect gets a fresh host.
try {
  while (true) {
    const msg = await readMessage();
    if (msg === null) {
      logStderr("stdin EOF — exiting");
      break;
    }
    if (msg.type === "request_update") await pushVars();
  }
} catch (e) {
  logStderr(`read loop error: ${e instanceof Error ? e.message : e}`);
}
