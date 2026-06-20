export type { DeckMeta, OutlineSlide, Outline } from "./types";
export { KNOWN_LAYOUTS } from "./types";
export { mintSlideId } from "./id";
export { parseOutline } from "./parse";
export { serializeOutline } from "./serialize";
export {
  validateOutline,
  crossValidate,
  type ValidationIssue,
} from "./validate";
export {
  readBoundRegions,
  updateBoundRegions,
  validateSlideSection,
  type SlideSectionIssue,
} from "./inject";
export {
  writeSlide,
  readSlide,
  listSlideIds,
  gcOrphans,
} from "./render-store";
