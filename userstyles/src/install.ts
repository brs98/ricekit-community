// One-time setup for the Ricekit Userstyles addon.
//
// Writes:
//   1. native-host/host.sh — wrapper that execs the Deno host with our script
//   2. Native messaging host manifest in Firefox / Zen's NativeMessagingHosts dirs
//
// Prints the next steps the user takes manually:
//   - Load the addon from addon/manifest.json (temporary install)
//   - Stylus → Import build/import.json (one-click bulk install of userstyles)

const HOST_NAME = "ricekit_userstyles";
const ADDON_ID = "ricekit-userstyles@ricekit.dev";

const HOME = Deno.env.get("HOME");
if (!HOME) throw new Error("HOME not set");

const here = new URL(".", import.meta.url).pathname; // .../userstyles/src/
const projectRoot = new URL("..", import.meta.url).pathname; // .../userstyles/
const hostScript = `${here}host.ts`;
const addonManifest = `${projectRoot}addon/manifest.json`;

// Host lives entirely under ~/.config/ricekit-userstyles/ — a single compiled
// binary plus its log. macOS TCC (13+) silently blocks Firefox from executing
// files under ~/Documents: no spawn, no error, no diagnostic. Compiling the
// host with `deno compile` produces a self-contained binary with no dep on
// the source tree, so Firefox only ever touches ~/.config paths.
const hostDir = `${HOME}/.config/ricekit-userstyles`;
const hostBin = `${hostDir}/host`;

// ---- resolve ricekit binary path (once, at install time) -----------------

// Firefox spawns native hosts with a minimal PATH, so `ricekit` on the user's
// PATH at install time won't be findable at runtime. Resolve the absolute
// path now and persist it to a config file the host reads at startup.
async function resolveRicekit(): Promise<string> {
  const which = new Deno.Command("which", {
    args: ["ricekit"],
    stdout: "piped",
    stderr: "null",
  });
  const { code, stdout } = await which.output();
  if (code === 0) {
    const path = new TextDecoder().decode(stdout).trim();
    if (path) return path;
  }
  // Probe common fallback locations before giving up.
  const candidates = [
    "/opt/homebrew/bin/ricekit",
    "/usr/local/bin/ricekit",
    `${HOME}/.cargo/bin/ricekit`,
    `${HOME}/.local/bin/ricekit`,
    `${HOME}/Documents/ricekit/target/release/ricekit`,
    `${HOME}/Documents/ricekit/target/debug/ricekit`,
  ];
  for (const p of candidates) {
    try {
      const s = await Deno.stat(p);
      if (s.isFile) return p;
    } catch {
      // keep probing
    }
  }
  throw new Error(
    "ricekit binary not found. Either put it on PATH or place it at one of:\n  " +
      candidates.join("\n  "),
  );
}

const ricekitBin = await resolveRicekit();

// ---- compile host binary --------------------------------------------------

await Deno.mkdir(hostDir, { recursive: true });

// Persist the resolved ricekit path for the host to read at runtime.
await Deno.writeTextFile(
  `${hostDir}/config.json`,
  JSON.stringify({ ricekitBin }, null, 2) + "\n",
);

const compile = new Deno.Command("deno", {
  args: [
    "compile",
    "--quiet",
    "--allow-read",
    "--allow-run",
    "--allow-env",
    "--allow-write",
    "--output",
    hostBin,
    hostScript,
  ],
  stdout: "piped",
  stderr: "piped",
});
const { code: cc, stderr: ccErr } = await compile.output();
if (cc !== 0) {
  console.error("deno compile failed:");
  console.error(new TextDecoder().decode(ccErr));
  Deno.exit(cc);
}

// ---- native-messaging manifest --------------------------------------------

const manifest = {
  name: HOST_NAME,
  description: "Ricekit Userstyles — live :root variable host",
  path: hostBin,
  type: "stdio",
  allowed_extensions: [ADDON_ID],
};
const manifestJson = JSON.stringify(manifest, null, 2);

const hostDirs: [string, string][] = [
  ["Firefox", `${HOME}/Library/Application Support/Mozilla/NativeMessagingHosts`],
  ["Zen Browser", `${HOME}/Library/Application Support/zen/NativeMessagingHosts`],
];

const registered: string[] = [];
for (const [label, dir] of hostDirs) {
  // Only register for browsers that have a profile directory (i.e. been run
  // at least once). Skipping silently for not-installed browsers.
  try {
    await Deno.stat(dir.replace(/\/NativeMessagingHosts$/, ""));
  } catch {
    continue;
  }

  await Deno.mkdir(dir, { recursive: true });
  const target = `${dir}/${HOST_NAME}.json`;
  await Deno.writeTextFile(target, manifestJson);
  registered.push(`  ${label}: ${target}`);
}

// ---- output ---------------------------------------------------------------

console.log("=== Ricekit Userstyles install ===\n");
console.log("Host binary:");
console.log(`  ${hostBin}`);
if (registered.length === 0) {
  console.log(
    "\n! No supported browser profile found. Run Firefox or Zen at least once, then re-run install.",
  );
} else {
  console.log("\nNative-messaging manifest registered for:");
  for (const line of registered) console.log(line);
}
console.log("\nNext steps:");
console.log("  1. Load the addon:");
console.log("     - open  about:debugging#/runtime/this-firefox");
console.log("     - click 'Load Temporary Add-on'");
console.log(`     - select  ${addonManifest}`);
console.log("");
console.log("  2. Bulk-install the 131 userstyles in Stylus:");
console.log("     - Stylus → Manage → 'Backup' (↕) → 'Import'");
console.log(`     - select  ${projectRoot}build/import.json`);
console.log("");
console.log("  After that: `ricekit apply <theme>` instantly re-themes every site.");
