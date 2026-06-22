import type { ModelClient, DigestResult, Direction } from "./model-client";
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

  return {
    outlineMarkdown: serializeOutline(outline),
    pointCount: digest.keyPoints.length,
    angle,
    digest: digest.keyPoints,
  };
}
