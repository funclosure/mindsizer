import { createInterface } from "node:readline";
import type { Direction } from "./model-client";

export interface Prompter {
  chooseAngle(options: Direction[]): Promise<Direction>;
}

/** Non-interactive picker: a specific id, or the first option. */
export function fixedPrompter(angleId?: string): Prompter {
  return {
    async chooseAngle(options) {
      if (options.length === 0) throw new Error("no directions proposed");
      if (!angleId) return options[0];
      const found = options.find((o) => o.id === angleId);
      if (!found) {
        throw new Error(
          `unknown angle '${angleId}' — choose from: ${options.map((o) => o.id).join(", ")}`,
        );
      }
      return found;
    },
  };
}

/** Interactive terminal picker — prints numbered options, reads a choice. */
export function terminalPrompter(): Prompter {
  return {
    async chooseAngle(options) {
      if (options.length === 0) throw new Error("no directions proposed");
      process.stdout.write("Aim it:\n");
      options.forEach((o, i) =>
        process.stdout.write(`  [${i + 1}] ${o.label} — ${o.description}\n`),
      );
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        while (true) {
          const answer = await new Promise<string>((resolve) =>
            rl.question("> ", resolve),
          );
          const n = Number(answer.trim());
          if (Number.isInteger(n) && n >= 1 && n <= options.length) {
            return options[n - 1];
          }
          process.stdout.write(`Enter 1-${options.length}.\n`);
        }
      } finally {
        rl.close();
      }
    },
  };
}
