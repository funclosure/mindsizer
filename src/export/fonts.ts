import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FONTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "theme",
  "fonts",
);

interface FontSpec {
  family: string;
  file: string;
  style: "normal" | "italic";
}

const FONTS: FontSpec[] = [
  { family: "Fraunces", file: "fraunces.woff2", style: "normal" },
  { family: "Fraunces", file: "fraunces-italic.woff2", style: "italic" },
  { family: "Geist", file: "geist.woff2", style: "normal" },
  { family: "Geist Mono", file: "geist-mono.woff2", style: "normal" },
];

function faceRule(spec: FontSpec): string | null {
  let data: Buffer;
  try {
    data = readFileSync(join(FONTS_DIR, spec.file));
  } catch {
    return null; // missing file → skip (degrade to system fallback)
  }
  const b64 = data.toString("base64");
  return (
    `@font-face{font-family:"${spec.family}";font-style:${spec.style};` +
    `font-weight:100 900;font-display:swap;` +
    `src:url(data:font/woff2;base64,${b64}) format("woff2");}`
  );
}

/** Build @font-face rules with base64-embedded woff2 for the Field type stack. */
export function fontFaceCss(): string {
  return FONTS.map(faceRule)
    .filter((r): r is string => r !== null)
    .join("\n");
}
