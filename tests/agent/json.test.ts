import { describe, it, expect } from "vitest";
import { z } from "zod";
import { extractJson, parseValidated } from "../../src/agent/json";

describe("extractJson", () => {
  it("returns plain JSON unchanged", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("strips a ```json code fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("extracts the object from surrounding prose", () => {
    expect(extractJson('Here is the digest: {"a":1} — done')).toBe('{"a":1}');
  });

  it("extracts an array", () => {
    expect(extractJson('[{"id":"x"}]')).toBe('[{"id":"x"}]');
  });

  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("parseValidated", () => {
  const schema = z.object({ a: z.number() });
  it("parses + validates", () => {
    expect(parseValidated('{"a":1}', schema)).toEqual({ a: 1 });
  });
  it("throws on schema mismatch", () => {
    expect(() => parseValidated('{"a":"x"}', schema)).toThrow();
  });
});
