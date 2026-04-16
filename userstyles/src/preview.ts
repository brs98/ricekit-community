// Standalone: run `ricekit theme show <name>` and print the 22 ricekit tokens.
// Usage: deno run -A src/preview.ts <theme-name>

import { parseRicekitThemeShow, type RicekitPalette } from "./palette.ts";

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

const palette = parseRicekitThemeShow(new TextDecoder().decode(stdout));

console.log(`ricekit palette (theme: ${themeName})\n`);
for (const [k, v] of Object.entries(palette) as [keyof RicekitPalette, string][]) {
  console.log(`  ${k.padEnd(16)} ${v}`);
}
