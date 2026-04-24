export type NativeStyleInput = {
  slug: string;
  name: string;
  description: string;
  author: string;
  domains: string[];
  css: string;
  desktopTargets: string[];
};

export type NativeStyleRender = {
  userCss: string;
  desktopCopies: { path: string; css: string }[];
};

const NAMESPACE = "github.com/brs98/ricekit-community/userstyles";
const HOMEPAGE_URL = "https://github.com/brs98/ricekit-community/tree/main/userstyles";
const SUPPORT_URL = "https://github.com/brs98/ricekit-community/issues";

export function renderNativeUserStyle(input: NativeStyleInput): NativeStyleRender {
  if (input.domains.length === 0) {
    throw new Error(`native style ${input.slug}: at least one domain is required`);
  }

  const css = input.css.endsWith("\n") ? input.css : `${input.css}\n`;
  const domainList = input.domains.map((domain) => `domain("${domain}")`).join(", ");
  const userCss = `/* ==UserStyle==
@name ${input.name}
@namespace ${NAMESPACE}
@homepageURL ${HOMEPAGE_URL}
@version 0
@updateURL https://raw.githubusercontent.com/brs98/ricekit-community/main/userstyles/build/dist/${input.slug}.user.css
@supportURL ${SUPPORT_URL}
@description ${input.description}
@author ${input.author}
@license MIT
==/UserStyle== */

@-moz-document ${domainList} {
${indentCss(css)}
}
`;

  return {
    userCss,
    desktopCopies: input.desktopTargets.map((path) => ({ path, css })),
  };
}

function indentCss(css: string): string {
  return css.split("\n").map((line) => line.length === 0 ? "" : `  ${line}`).join("\n");
}