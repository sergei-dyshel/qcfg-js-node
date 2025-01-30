import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { LoggableError, assert } from "@sergei-dyshel/typescript/error";
import { Subprocess } from "..";
import * as Cmd from "../cmdline-builder";
import { logRun, type Command, type RunLogOptions, type Runner } from "../subprocess";

/** Base class for all errors */
export class Error extends LoggableError {
  protected static override namePrefix = "Git.";
}

export namespace Error {
  /** Error originated from failure of git command but not recognized specifically */
  export class Other extends Error {
    protected static override namePrefix = "Git.Error.";
  }

  /** Errors when parsing git command output by functions in this module */
  export class Parse extends Error {
    protected static override namePrefix = "Git.Error.";
  }

  export class NotAGitRepo extends Error {
    protected static override namePrefix = "Git.Error.";
  }

  export class NotAGitDir extends Error {
    protected static override namePrefix = "Git.Error.";
  }
}

/**
 * Git options common for all commands
 *
 * See {@link https://git-scm.com/docs/git}.
 */
/**
 * Options common to all git commands.
 *
 * Passed to `git` comman line as argument preceeing subcommand, e.g.
 *
 *     git -C <cwd> <subcommand> <args>
 */
export interface CommonOptions {
  /**
   * Directory in which to run git command, passed to git as `git -C`
   *
   * All paths and pathspecs passed to git are relative to this directory.
   */
  cwd?: string;
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

/**
 * Options for running git command.
 *
 * Beside common flags for git command {@link CommonOptions} has options determining how to run git
 * dubprocess.
 */
export type RunOptions = CommonOptions & {
  /** Path to git executable. By default use `git`. */
  gitBin?: string;

  runner?: Runner;

  run?: Subprocess.RunOptions;

  /**
   * Options for logging git command
   *
   * NOTE: these are unrelated to log options of underlying runner. Only git sub-command and
   * following options are logged (i.e. --git-dir etc. are not logged).
   */
  log?: RunLogOptions;
};

export async function internalRun(args: string[], options?: RunOptions) {
  try {
    const runner = options?.runner ?? Subprocess.run;
    return await runner([options?.gitBin ?? "git", ...args], options?.run);
  } catch (err) {
    // wrap all errors other than throwed by this module
    if (err instanceof Error) throw err;
    throw Error.Other.wrap(err, "Git command failed");
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
export const preCmdSchema = Cmd.schema({
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
  const subCmd = [
    ...(typeof command === "string" ? [command] : command),
    ...Cmd.build(Cmd.extend(commonSchema, commandSchema), options),
    ...fixedArgs,
  ];
  logRun(["git", ...subCmd], options?.log);
  return internalRun(
    [...Cmd.build(preCmdSchema, options), ...subCmd],
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

/** Enable logging by default in modifying commands */
export const logByDefault = { log: { shouldLog: true } } as RunOptions;

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
export const HEAD = "HEAD";
