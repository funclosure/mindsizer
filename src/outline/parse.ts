import matter from "gray-matter";
import * as yaml from "js-yaml";
import type { DeckMeta, Outline, OutlineSlide, SlidePlan } from "./types";
import { PlanDirectionSchema } from "./plan";

const SLIDE_META_RE = /<!--\s*slide\s+([^>]*?)\s*-->/;
const HEADING_RE = /^#\s+(.+?)\s*$/m;

/** Parse `key=value` / `key="quoted value"` attribute pairs. */
function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/(\w+)=("([^"]*)"|(\S+))/g)) {
    out[m[1]] = m[3] ?? m[4];
  }
  return out;
}

/** Normalize the frontmatter `source` value: `url` string shorthand or {label, url} object. */
function parseSource(raw: unknown): DeckMeta["source"] {
  if (typeof raw === "string") {
    const url = raw.trim();
    return url ? { url } : undefined;
  }
  if (raw && typeof raw === "object") {
    const pick = (v: unknown) =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;
    const label = pick((raw as Record<string, unknown>).label);
    const url = pick((raw as Record<string, unknown>).url);
    if (label || url) return { ...(label && { label }), ...(url && { url }) };
  }
  return undefined;
}

/** A ```plan fence at the very end of a slide body (CRLF-tolerant). */
const PLAN_FENCE_RE = /\n*```plan[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*\r?$/;

/**
 * A ```plan fence opener anywhere in the body — used to catch one the trailing rule missed.
 * Deliberately over-triggers: a fence merely QUOTED in prose (or nested in a wider fence) also
 * raises planError. Losing a real plan silently is the worse failure, so we accept the noise.
 */
const ANY_PLAN_FENCE_RE = /(?:^|\n)[ \t]*```plan[ \t]*\r?$/m;

/** Front-matter `direction` → PlanDirection, or undefined when absent/incomplete. */
function parseDirection(raw: unknown): DeckMeta["direction"] {
  const r = PlanDirectionSchema.safeParse(raw);
  return r.success ? r.data : undefined;
}

/**
 * Lift a trailing ```plan fence out of a slide body. Returns the body without the fence and
 * the parsed plan — or, when the fence isn't valid YAML / not a mapping, the ORIGINAL body
 * (fence kept, so serialize round-trips) plus a planError. Shape validation is validate.ts's job.
 */
function liftPlan(body: string): { markdown: string; plan?: SlidePlan; planError?: string } {
  const m = body.match(PLAN_FENCE_RE);
  if (!m) {
    // A fence that isn't the LAST block would otherwise vanish silently — indistinguishable from
    // "there was never a plan". Say so instead; validateOutline surfaces it, naming the slide.
    return ANY_PLAN_FENCE_RE.test(body)
      ? { markdown: body, planError: "plan fence must be the last block in the slide" }
      : { markdown: body };
  }
  let value: unknown;
  try {
    value = yaml.load(m[1].replace(/\r\n?/g, "\n"));
  } catch (e) {
    return { markdown: body, planError: `plan fence is not valid YAML: ${(e as Error).message.split("\n")[0]}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { markdown: body, planError: "plan fence must be a YAML mapping" };
  }
  return { markdown: body.slice(0, m.index).trim(), plan: value as SlidePlan };
}

/** Parse a Marp-style outline.md into the canonical Outline model. */
export function parseOutline(md: string): Outline {
  const { data, content } = matter(md);
  const source = parseSource(data.source);
  const direction = parseDirection(data.direction);
  const meta: DeckMeta = {
    title: String(data.title ?? ""),
    purpose: "teach",
    theme: String(data.theme ?? "field"),
    ...(source && { source }),
    ...(direction && { direction }),
  };

  // gray-matter has stripped the leading frontmatter, so remaining
  // `---` lines are slide separators — but only when immediately followed
  // by a slide comment. A `---` thematic break inside a body is preserved.
  const blocks = content
    .split(/\r?\n[ \t]*-{3,}[ \t]*\r?\n(?=\s*<!--\s*slide\b)/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const slides: OutlineSlide[] = blocks.map((block) => {
    const metaMatch = block.match(SLIDE_META_RE);
    const attrs = metaMatch ? parseAttrs(metaMatch[1]) : {};
    const id = attrs.id ?? "";
    const layout = attrs.layout ?? "bespoke";

    const afterMeta = metaMatch
      ? block.slice(metaMatch.index! + metaMatch[0].length)
      : block;

    const headingMatch = afterMeta.match(HEADING_RE);
    const title = headingMatch ? headingMatch[1].trim() : "";
    const body = headingMatch
      ? afterMeta.slice(headingMatch.index! + headingMatch[0].length)
      : afterMeta;

    const lifted = liftPlan(body.trim());
    return {
      id,
      layout,
      title,
      markdown: lifted.markdown,
      ...(lifted.plan && { plan: lifted.plan }),
      ...(lifted.planError && { planError: lifted.planError }),
    };
  });

  return { meta, slides };
}
