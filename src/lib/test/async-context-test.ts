/**
 * @file Write to stdout/stderr in parallel async routines
 *
 *   Each routine prepends output line with prefix. Verify that lines from different routines are not
 *   merged.
 */

import "@sergei-dyshel/typescript/shims";

import { mapAsync } from "@sergei-dyshel/typescript/array";
import { randomInt } from "node:crypto";
import { EOL } from "node:os";
import { setTimeout } from "node:timers/promises";
import { AsyncContext } from "../async-context";

const prefixes = ["one", "two", "three"];

async function main() {
  await mapAsync(prefixes, async (prefix) =>
    AsyncContext.run(
      AsyncContext.transformStd({
        stdout: (line) => `[stdout:${prefix}] ${line}`,
        stderr: (line) => `[stderr:${prefix}] ${line}`,
      }),
      async () => {
        const stdout = AsyncContext.getStdout();
        const stderr = AsyncContext.getStderr();

        for (let j = 0; j < 5; j++) {
          for (let i = 0; i < 10; i++) {
            stdout.write(`${prefix} `);
            stderr.write(`${prefix} `);
          }
          stdout.write(EOL);
          stderr.write(EOL);

          await setTimeout(randomInt(5));
        }

        stdout.write("some line not ending with newline");
      },
    ),
  );
}

void main();
