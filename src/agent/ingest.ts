import { INSTRUMENTS, type ModelClient, type DigestResult, type Direction } from "./model-client";
import type { Prompter } from "./prompter";
import type { Outline } from "../outline/types";
import { mintSlideId } from "../outline/id";
import { validateOutline } from "../outline/validate";
import { serializeOutline } from "../outline/serialize";

export interface IngestDeps {
  model: ModelClient;
  prompter: Prompter;
  onDigest?: (digest: DigestResult) => void;
}

export interface IngestResult {
  outlineMarkdown: string;
  pointCount: number;
  angle: Direction;
  digest: string[];
  direction?: {
    conceit: string;
    motif: string;
    roleById: Record<string, string>;
    instrumentById: Record<string, string>;
  };
}

/** text → digest → direction → outline.md (markdown string). No IO of its own. */
export async function ingest(
  sourceText: string,
  deps: IngestDeps,
): Promise<IngestResult> {
  if (!sourceText.trim()) throw new Error("source is empty");

  const digest = await deps.model.digest(sourceText);
  deps.onDigest?.(digest);

  const directions = await deps.model.proposeDirections(digest);
  const angle = await deps.prompter.chooseAngle(directions);
  const draft = await deps.model.generateOutline(digest, angle);

  const outline: Outline = {
    meta: { title: draft.title || digest.title, purpose: "teach", theme: "field" },
    slides: draft.slides.map((s) => ({
      id: mintSlideId(),
      layout: s.layout,
      title: s.title,
      markdown: s.markdown,
    })),
  };

  const issues = validateOutline(outline);
  if (issues.length > 0) {
    throw new Error(
      "generated outline invalid:\n" +
        issues
          .map((i) => `  - ${i.slideId ? i.slideId + ": " : ""}${i.message}`)
          .join("\n"),
    );
  }

  // Whole-deck art direction — best-effort and GUARDED: a missing method (old clients/fakes) or a
  // transient failure must NEVER discard the already-validated outline.
  let direction: IngestResult["direction"];
  if (deps.model.directArt) {
    try {
      const art = await deps.model.directArt(digest, angle, outline.slides.map((s) => s.title));
      const pool = INSTRUMENTS.filter((x) => x !== "none");
      const used = new Set<string>();
      const roleById: Record<string, string> = {};
      const instrumentById: Record<string, string> = {};
      outline.slides.forEach((s, i) => {
        const a = art.slides[i];
        roleById[s.id] = a?.role ?? "";
        let inst: string = a?.instrument ?? "none";
        if (inst !== "none" && used.has(inst)) {
          const free = pool.find((x) => !used.has(x));
          if (free) inst = free; // else palette exhausted → accept the repeat
        }
        if (inst !== "none") used.add(inst);
        instrumentById[s.id] = inst;
      });
      direction = { conceit: art.conceit, motif: art.motif, roleById, instrumentById };
    } catch {
      /* art direction is best-effort — never fatal */
    }
  }

  return {
    outlineMarkdown: serializeOutline(outline),
    pointCount: digest.keyPoints.length,
    angle,
    digest: digest.keyPoints,
    direction,
  };
}
