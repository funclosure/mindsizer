import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const THEMES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "themes");

export interface Theme { name: string; css: string; fontFaceCss: string; brief: string; }
interface FontSpec { family: string; file: string; style: "normal" | "italic"; }

/** Theme directory names (folders under themes/, excluding the shared fonts pool). */
export function listThemes(): string[] {
  return readdirSync(THEMES_DIR).filter(
    (n) => n !== "fonts" && statSync(join(THEMES_DIR, n)).isDirectory(),
  );
}

function faceRule(dir: string, spec: FontSpec): string | null {
  // resolve the woff2 from the theme's own fonts/ first, else the shared pool
  const candidates = [join(dir, "fonts", spec.file), join(THEMES_DIR, "fonts", spec.file)];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return null;
  const b64 = readFileSync(path).toString("base64");
  return (
    `@font-face{font-family:"${spec.family}";font-style:${spec.style};` +
    `font-weight:100 900;font-display:swap;` +
    `src:url(data:font/woff2;base64,${b64}) format("woff2");}`
  );
}

/** Load a theme from themes/<name>/ — { css, fontFaceCss (embedded), brief }. */
export function loadTheme(name: string): Theme {
  const dir = join(THEMES_DIR, name);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`unknown theme '${name}' — available: ${listThemes().join(", ")}`);
  }
  const read = (f: string) => {
    const p = join(dir, f);
    if (!existsSync(p)) throw new Error(`theme '${name}' is missing ${f}`);
    return readFileSync(p, "utf8");
  };
  const css = read("theme.css");
  const brief = read("brief.md").trim();
  const specs = JSON.parse(read("fonts.json")) as FontSpec[];
  const fontFaceCss = specs.map((s) => faceRule(dir, s)).filter((r): r is string => r !== null).join("\n");
  return { name, css, fontFaceCss, brief };
}
