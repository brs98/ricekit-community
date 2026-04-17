// Figure out exactly what postcss-less does with LESS mixin syntax.
import postcssLess from "npm:postcss-less@6.0.0";

const samples = [
  `.heart-actions() { color: red; }`,
  `.heart-actions();`,
  `.heart-actions() !important;`,
  `#each(@list, { .x { y: z; } });`,
  `#--variables() { color: blue; }`,
  `#--variables() !important;`,
];

for (const src of samples) {
  const root = postcssLess.parse(src);
  const rt = root.toString();
  console.log(`orig: ${JSON.stringify(src)}`);
  console.log(`rtrp: ${JSON.stringify(rt)}`);
  console.log();
}
