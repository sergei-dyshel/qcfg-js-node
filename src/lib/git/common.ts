import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { LoggableError, assert } from "@sergei-dyshel/typescript/error";
import { Subprocess } from "..";
import * as Cmd from "../cmdline-builder";
import type { Command, Runner } from "../subprocess";

export class RunError extends LoggableError {}

/** Error parsing git output */
export class ParseError extends LoggableError {}

/**
 * Git options common for all commands
 *
 * See {@link https://git-scm.com/docs/git}.
 */
export interface CommonOptions {
  /**
   * Do not pipe Git output into a pager.
   */
  noPager?: boolean;
  /**
   * Set the path to the repository (".git" directory)
   *
   * Interpreted relative to {@link RunOptions.cwd}.
   * {@link https://git-scm.com/docs/git#Documentation/git.txt---git-dirltpathgt}
   */
  gitDir?: string;

  /**
   * Set the path to the working tree.
   *
   * Interpreted relative to {@link RunOptions.cwd}.
   */
  workTree?: string;
}

export type RunOptions = CommonOptions & {
  /** Directory in which to run git command, passed to git as `git -C` */
  cwd?: string;

  /** Path to git executable. By default use `git`. */
  gitBin?: string;

  runner?: Runner;

  run?: Subprocess.RunOptions;
};

export async function run(args: string[], options?: RunOptions) {
  try {
    const runner = options?.runner ?? Subprocess.run;
    return await runner([options?.gitBin ?? "git", ...args], options?.run);
  } catch (err) {
    throw RunError.wrap(err, "Git command failed");
  }
}

/** Command schema with git options common for multiple commands. */
const commonSchema = Cmd.schema({
  quiet: Cmd.boolean(),
  verbose: Cmd.boolean(),
  progress: Cmd.boolean(),
  porcelain: Cmd.boolean(),
  nullTerminated: Cmd.boolean({ custom: "-z" }),
  force: Cmd.boolean(),
});

/** Options that come before command in git command line */
const preCmdSchema = Cmd.schema({
  noPager: Cmd.boolean(),
  gitDir: Cmd.string(),
  workTree: Cmd.string(),
  cwd: Cmd.string({ custom: "-C" }),
});

type GitCommandOptions = Cmd.Data<typeof commonSchema>;

export async function runCommand<S extends Cmd.Schema>(
  command: Command,
  args: string | string[] | undefined,
  commandSchema: S,
  options?: Cmd.Data<S> & GitCommandOptions & RunOptions,
) {
  const fixedArgs = typeof args === "string" ? [args] : args ?? [];
  return run(
    [
      ...Cmd.build(preCmdSchema, options),
      ...(typeof command === "string" ? [command] : command),
      ...Cmd.build(Cmd.extend(commonSchema, commandSchema), options),
      ...fixedArgs,
    ],
    deepMerge<RunOptions>({ run: { check: true } }, options),
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
export const logByDefault = { run: { log: { shouldLog: true } } } as RunOptions;

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
