import { describe, it, expect } from "vitest";
import { parseOutline } from "../../src/outline/parse";
import { serializeOutline } from "../../src/outline/serialize";
import type { Outline } from "../../src/outline/types";

const PLAN_MD = `---
title: Crank
purpose: teach
theme: field
direction:
  conceit: hand-cranking an engine
  motif: a flywheel
  arc: force → resist → catch
---

<!-- slide id=s_a -->
# Startups don't start themselves

Founders are the engine.

\`\`\`plan
claim: Founders supply the momentum by hand.
mechanism: growth = push + momentum
device:
  kind: instrument
  operate: drag a crank
  changes: curve splits
  resting: crank at 40%
aha: release early → zero
\`\`\`

---

<!-- slide id=s_b layout=plain -->
# No plan here

- just prose
`;

describe("parseOutline — plan fence + direction", () => {
  it("lifts direction from front-matter", () => {
    const o = parseOutline(PLAN_MD);
    expect(o.meta.direction).toEqual({ conceit: "hand-cranking an engine", motif: "a flywheel", arc: "force → resist → catch" });
  });
  it("lifts the trailing plan fence into slide.plan and strips it from markdown", () => {
    const s = parseOutline(PLAN_MD).slides[0];
    expect(s.plan?.claim).toBe("Founders supply the momentum by hand.");
    expect(s.plan?.device.kind).toBe("instrument");
    expect(s.markdown).toBe("Founders are the engine.");
    expect(s.planError).toBeUndefined();
  });
  it("leaves a fence-less slide untouched", () => {
    const s = parseOutline(PLAN_MD).slides[1];
    expect(s.plan).toBeUndefined();
    expect(s.markdown).toBe("- just prose");
  });
  it("keeps a malformed fence in markdown and records planError", () => {
    const bad = PLAN_MD.replace("aha: release early → zero", "aha: [unclosed");
    const s = parseOutline(bad).slides[0];
    expect(s.plan).toBeUndefined();
    expect(s.planError).toMatch(/yaml/i);
    expect(s.markdown).toContain("```plan");
  });
  it("records planError when the fence is valid YAML but not a mapping", () => {
    const bad = PLAN_MD.replace(/```plan[\s\S]*?```/, "```plan\n- a\n- b\n```");
    const s = parseOutline(bad).slides[0];
    expect(s.plan).toBeUndefined();
    expect(s.planError).toMatch(/mapping/i);
  });
  it("flags a plan fence that is not the last block instead of dropping it silently", () => {
    const trailing = PLAN_MD.replace(
      "aha: release early → zero\n```\n",
      "aha: release early → zero\n```\n\nNote to self: tighten this later.\n",
    );
    const s = parseOutline(trailing).slides[0];
    expect(s.plan).toBeUndefined();
    expect(s.planError).toMatch(/last block/i);
    expect(s.markdown).toContain("```plan"); // fence preserved so serialize round-trips
  });
  it("flags an unterminated plan fence rather than parsing plan-less", () => {
    const s = parseOutline("<!-- slide id=s_a -->\n# T\n\nbody\n\n```plan\nclaim: x\n").slides[0];
    expect(s.plan).toBeUndefined();
    expect(s.planError).toMatch(/last block/i);
  });
  it("lifts a plan fence from a CRLF-line-ending file", () => {
    const o = parseOutline(PLAN_MD.replace(/\n/g, "\r\n"));
    expect(o.meta.direction?.conceit).toBe("hand-cranking an engine");
    expect(o.slides).toHaveLength(2);
    const s = o.slides[0];
    expect(s.planError).toBeUndefined();
    expect(s.plan?.claim).toBe("Founders supply the momentum by hand.");
    expect(s.plan?.device.operate).toBe("drag a crank");
    expect(s.markdown).not.toContain("```plan");
  });
  it("stays plan-less and error-free for a plain outline with no fence at all", () => {
    const s = parseOutline("<!-- slide id=s_a -->\n# T\n\n- a bullet\n").slides[0];
    expect(s.plan).toBeUndefined();
    expect(s.planError).toBeUndefined();
  });
  it("does not parse direction without conceit + motif + arc", () => {
    const o = parseOutline(PLAN_MD.replace("  arc: force → resist → catch\n", ""));
    expect(o.meta.direction).toBeUndefined();
  });
});

describe("serializeOutline — plan fence + direction", () => {
  const outline: Outline = {
    meta: { title: "Crank", purpose: "teach", theme: "field", direction: { conceit: "c", motif: "m", arc: "a" } },
    slides: [
      { id: "s_a", layout: "bespoke", title: "T", markdown: "prose",
        plan: { claim: "cl", mechanism: "me", device: { kind: "figure", resting: "r" }, source: "q: with colon" } },
      { id: "s_b", layout: "plain", title: "U", markdown: "- x" },
    ],
  };
  it("writes direction and a trailing plan fence", () => {
    const md = serializeOutline(outline);
    expect(md).toContain("direction:\n  conceit: c\n  motif: m\n  arc: a");
    expect(md).toMatch(/prose\n\n```plan\nclaim: cl\n[\s\S]*```\n/);
    expect(md.split("```plan").length - 1).toBe(1);
  });
  it("round-trips parse(serialize(o)) === o", () => {
    expect(parseOutline(serializeOutline(outline))).toEqual(outline);
  });
  it("serialize(parse(md)) is stable after one pass", () => {
    const once = serializeOutline(parseOutline(PLAN_MD));
    expect(serializeOutline(parseOutline(once))).toBe(once);
  });
});
