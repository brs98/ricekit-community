import { compileUserLess } from "./compile.ts";

const site = Deno.args[0];
if (!site) {
  console.error("usage: deno run -A src/pinpoint.ts <site>");
  Deno.exit(1);
}

try {
  await compileUserLess(
    await Deno.readTextFile(`upstream/catppuccin/styles/${site}/catppuccin.user.less`),
  );
  console.log(`${site}: OK`);
} catch (e) {
  const err = e as {
    line?: number;
    column?: number;
    message: string;
    extract?: string[];
  };
  console.log(`ERROR ${site}:`, err.message);
  console.log(`  at line ${err.line}, col ${err.column}`);
  if (err.extract) console.log("  extract:", err.extract.map((x) => JSON.stringify(x)).join("\n    "));
}
