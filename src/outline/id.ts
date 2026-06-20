import { customAlphabet } from "nanoid";

const nano = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

/** Mint a stable, permanent slide id, e.g. "s_abc12345". */
export function mintSlideId(): string {
  return `s_${nano()}`;
}
