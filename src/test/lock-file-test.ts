/**
 * @file Stress test for LockFile
 *
 *   Single-process variant just locks and unlocks in a loop.
 *
 *   Multi-process variant Creates N works each of them runs single-process variant and SIGKILLs it in
 *   a loop. This way we test non-trivial aspects of implementation such as dead PID detection,
 *   takeovers, in-progress detection etc.
 */

import { OnTerminate, Yargs } from "@sergei-dyshel/node";
import { Iterator } from "@sergei-dyshel/typescript";
import { mapAsync } from "@sergei-dyshel/typescript/array";
import { randomInt } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { AsyncContext } from "../lib/async-context";
import { LockFile } from "../lib/lock/lock-file";
import { configureLogging, LogLevel, LogLevels, RootLogger } from "../lib/logging";
import { run } from "../lib/subprocess";

const logger = RootLogger.get();

const BASE = ".test";
const PATH = `${BASE}/lock`;
const CONFIG = `${BASE}/config.json`;

const yargsOptions = Yargs.options({
  ...Yargs.verbose,
  interval: {
    type: "number",
    alias: "i",
    default: 10,
    describe: "Interval between locking/unlocking (ms)",
  },
  timeout: { type: "number", alias: "t", default: 3000, describe: "Timeout for locking (ms)" },
  processes: { type: "number", alias: "p", default: 1, describe: "Number of processes to spawn" },
  kill: { type: "number", alias: "k", describe: "Kill process after this interval (ms)" },
});

type Options = Yargs.InferredOptionTypes<typeof yargsOptions>;

async function runWorker(args: Options) {
  for (;;) {
    await run([process.argv[1], "--config", CONFIG], {
      check: true,
      signal: OnTerminate.signal(),
      timeout: args.kill ? randomInt(args.kill) : undefined,
      killSignal: "SIGKILL",
      allowedExitSignals: ["SIGKILL"],
    });
    logger.info("Killed");
  }
}

async function runProcesses(args: Options) {
  const nrProcesses = args.processes;
  args.processes = 1;
  await writeFile(CONFIG, JSON.stringify(args));

  await mapAsync(Array.from(Iterator.range(nrProcesses)), (i) =>
    AsyncContext.prefixStd(`worker${i}\t`, () => runWorker(args)),
  );
}

async function main() {
  const args = Yargs.create({ commands: false, completion: false })
    .options(yargsOptions)
    .config()
    .strict()
    .parseSync();

  configureLogging({ handler: { level: LogLevels.addVerbosity(LogLevel.WARNING, args.verbose) } });
  OnTerminate.install();

  if (args.processes > 1) {
    return runProcesses(args);
  }

  await using lockfile = new LockFile(PATH);
  for (;;) {
    logger.debug("Locking");
    await lockfile.lock({ timeoutMs: args.timeout });
    await OnTerminate.setTimeout(randomInt(args.interval));

    logger.debug("Unlocking");
    await lockfile.unlock({ verify: true });

    await OnTerminate.setTimeout(randomInt(args.interval));
  }
}

void main();
