import { describe, it, expect } from "vitest";
import { fixedPrompter } from "../../src/agent/prompter";

const options = [
  { id: "mental-model", label: "mental model", description: "why" },
  { id: "build", label: "build", description: "how" },
];

describe("fixedPrompter", () => {
  it("picks the first option when no id is given", async () => {
    expect((await fixedPrompter().chooseAngle(options)).id).toBe("mental-model");
  });

  it("picks the option matching the given id", async () => {
    expect((await fixedPrompter("build").chooseAngle(options)).id).toBe("build");
  });

  it("throws listing valid ids for an unknown id", async () => {
    await expect(fixedPrompter("nope").chooseAngle(options)).rejects.toThrow(
      /unknown angle 'nope'.*mental-model, build/,
    );
  });

  it("throws when there are no options", async () => {
    await expect(fixedPrompter().chooseAngle([])).rejects.toThrow(/no directions/);
  });
});
