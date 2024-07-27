import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { LoggableError, assert } from "@sergei-dyshel/typescript/error";
import * as Cmd from "../cmdline-builder";
import type { RunFunc } from "../runner";
import {
  run as subprocessRun,
  type Command,
  type RunOptions as SubprocessRunOptions,
} from "../subprocess";

export class RunError extends LoggableError {}

/** Error parsing git output */
export class ParseError extends LoggableError {}

export interface BaseOptions {
  /** Directory in which to run git command */
  cwd?: string;

  runFunc?: RunFunc;
}

export interface RunOptions extends BaseOptions {
  run?: SubprocessRunOptions;
}

export async function run(args: string[], options?: RunOptions) {
  try {
    const runFunc = options?.runFunc ?? subprocessRun;
    return await runFunc(["git", ...args], deepMerge(options?.run, { cwd: options?.cwd }));
  } catch (err) {
    throw RunError.wrap(err, "Git command failed");
  }
}

/** Command schema with git options common for multiple commands. */
const commonSchema = Cmd.schema({
  quiet: Cmd.boolean(),
  porcelain: Cmd.boolean(),
  nullTerminated: Cmd.boolean({ custom: "-z" }),
  force: Cmd.boolean(),
});

type GitCommandOptions = Cmd.Data<typeof commonSchema>;

export async function runCommand<S extends Cmd.Schema>(
  command: Command,
  args: string[],
  commandSchema?: S,
  options?: Cmd.Data<S> & GitCommandOptions & RunOptions,
) {
  return run(
    [
      ...(typeof command === "string" ? [command] : command),
      ...Cmd.build(Cmd.extend(commonSchema, commandSchema), options),
      ...args,
    ],
    options,
  );
}

export function splitOutput(output: string, nullTerminated = false): string[] {
  const lines = output.split(nullTerminated ? "\0" : "\n");
  assert(
    lines[lines.length - 1] === "",
    "Git output is supposed to end with delimiter character",
    output,
  );
  lines.pop();
  return lines;
}

/** Modify run options to enable logging if not disabled in runner */
export const logByDefault = { run: { log: { shouldLog: true } } } as const;

export const withOut = {
  run: {
    stdout: "pipe",
  },
} as const;

export const withOutErr = {
  run: {
    stdout: "pipe",
    stderr: "pipe",
  },
} as const;

export const noCheck = {
  run: {
    check: false,
  },
} as const;
