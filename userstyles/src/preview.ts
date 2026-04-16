// Standalone: run `ricekit theme show <name>` and print the 26-token mapping.
// Usage: deno run -A src/preview.ts <theme-name>

import { mapRicekitToCatppuccin, parseRicekitThemeShow, CATPPUCCIN_TOKENS } from "./palette.ts";

const themeName = Deno.args[0];
if (!themeName) {
  console.error("usage: deno run -A src/preview.ts <theme-name>");
  Deno.exit(1);
}

const ricekitBin = Deno.env.get("RICEKIT_BIN") ??
  "/Users/parker/Documents/ricekit/target/debug/ricekit";

const cmd = new Deno.Command(ricekitBin, {
  args: ["theme", "show", themeName],
  stdout: "piped",
});
const { code, stdout } = await cmd.output();
if (code !== 0) {
  console.error(`ricekit theme show failed (exit ${code})`);
  Deno.exit(code);
}

const ricekit = parseRicekitThemeShow(new TextDecoder().decode(stdout));
const ctp = mapRicekitToCatppuccin(ricekit);

console.log(`ricekit palette → Catppuccin 26 tokens (theme: ${themeName})\n`);
for (const t of CATPPUCCIN_TOKENS) {
  console.log(`  ${t.padEnd(10)} ${ctp[t]}`);
}
