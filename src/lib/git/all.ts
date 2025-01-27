import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import type { AnyFunction } from "@sergei-dyshel/typescript/types";
import { join } from "node:path";
import type { Subprocess } from "..";
import * as Cmd from "../cmdline-builder";
import { exists } from "../filesystem";
import {
  logByDefault,
  noCheck,
  ParseError,
  runCommand,
  splitOutput,
  withOut,
  withOutErr,
  type RunOptions,
} from "./common";
import * as Config from "./config";
import * as Diff from "./diff";
import * as Log from "./log";
import * as Remote from "./remote";

export { Config, Diff, Log, Remote, type RunOptions };

export const DEFAULT_GIT_DIR = ".git";

// TODO: implement parsing for git status
export type StatusEntry = string;

export class Instance {
  constructor(readonly options?: RunOptions) {}

  init = this.wrap(init);
  clone = this.wrap(clone);
  add = this.wrap(add);
  commit = this.wrap(commit);
  status = this.wrap(status);
  branchList = this.wrap(branchList);
  commitExists = this.wrap(commitExists);
  commitExistsOnRemote = this.wrap(commitExistsOnRemote);
  revParse = this.wrap(revParse);
  revParseHead = this.wrap(revParseHead);
  checkout = this.wrap(checkout);
  getBlob = this.wrap(getBlob);
  fetch = this.wrap(fetch);
  reset = this.wrap(reset);
  catFile = this.wrap(catFile);
  version = this.wrap(version);
  show = this.wrap(show);
  push = this.wrap(push);

  getConfig = this.wrap(Config.get);
  getConfigCustom = this.wrap(Config.getCustom);
  setConfig = this.wrap(Config.set);
  setConfigCustom = this.wrap(Config.setCustom);
  unsetConfig = this.wrap(Config.unset);
  setUser = this.wrap(Config.setUser);
  setConfigRemote = this.wrap(Config.Remote.set);
  getConfigRemote = this.wrap(Config.Remote.get);

  remoteAdd = this.wrap(Remote.add);
  remoteList = this.wrap(Remote.list);

  diffRaw = this.wrap(Diff.raw);
  diffParse = this.wrap(Diff.parse);

  // REFACTOR: add rest of git commands

  // TYPING: only accept functions with last parameter type extending RunOptions
  private wrap<F extends AnyFunction>(fn: F): F {
    return ((...args: Parameters<F>) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      args[fn.length - 1] = deepMerge(this.options, args[fn.length - 1]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return fn(...args);
    }) as F;
  }
}

/**
 * Current directory is git repo root, i.e. contains .git file/directory
 *
 * NOTE: Doesn't check if it's VALID repo
 *
 * FIXME: Does not use runner, so only can be used for local paths
 */
export async function isRepoRoot(options?: RunOptions) {
  return exists(join(options?.cwd ?? ".", ".git"));
}

/**
 * Create an empty Git repository or reinitialize an existing one
 *
 * https://git-scm.com/docs/git-init
 */
export async function init(
  options?: {
    /**
     * Use <branch-name> for the initial branch in the newly created repository. If not specified,
     * fall back to the default name (currently `master`, but this is subject to change in the
     * future; the name can be customized via the `init.defaultBranch` configuration variable).
     *
     * {@link https://git-scm.com/docs/git-init#Documentation/git-init.txt-code--initial-branchltbranch-namegtcode}
     */
    initialBranch?: string;

    /**
     * Specify the directory from which templates will be used.
     *
     * {@link https://git-scm.com/docs/git-init#Documentation/git-init.txt-code--templatelttemplate-directorygtcode}
     *
     * {@link https://git-scm.com/docs/git-init#_template_directory}
     */
    template?: string;

    /**
     * Only print error and warning messages; all other output will be suppressed.
     */
    quiet?: boolean;
  } & RunOptions,
) {
  return runCommand(
    "init",
    [],
    Cmd.schema({ initialBranch: Cmd.string(), template: Cmd.string() }),
    deepMerge(logByDefault, options),
  );
}

/**
 * {@link https://git-scm.com/docs/git-clone}}
 */
export function clone(
  repository: string,
  options?: {
    /** Directory to clone to */
    directory?: string;
    /** Operate quietly. Progress is not reported to the standard error stream. */
    quiet?: boolean;
    /** Run verbosely. Does not affect the reporting of progress status to the standard error stream. */
    verbose?: boolean;
    /**
     * Progress status is reported on the standard error stream by default when it is attached to a
     * terminal, unless --quiet is specified. This flag forces progress status even if the standard
     * error stream is not directed to a terminal.
     */
    progress?: boolean;
  } & RunOptions,
) {
  return runCommand(
    "clone",
    [repository, ...(options?.directory ? [options.directory] : [])],
    {},
    options,
  );
}

/**
 * `git add`
 *
 * https://www.git-scm.com/docs/git-add
 */
export async function add(
  pathspecs: string | string[] | undefined,
  options?: {
    /**
     * Update index with all modified files. If no pathspecs given, ALL files in working tree ad
     * updated
     */
    all?: boolean;
    /**
     * Update the index just where it already has an entry matching <pathspec>. If no <pathspec> is
     * given when -u option is used, ALL TRACKED files in the entire working tree are updated
     */
    update?: boolean;
  } & RunOptions,
) {
  return runCommand(
    "add",
    typeof pathspecs === "string" ? [pathspecs] : pathspecs,
    { all: Cmd.boolean(), update: Cmd.boolean() },
    deepMerge(logByDefault, options),
  );
}

/**
 * `git commit`
 *
 * https://git-scm.com/docs/git-commit
 */
export async function commit(
  options?: {
    /**
     * Automatically stage files that have been modified and deleted, but new files you have not
     * told Git about are not affected
     */
    all?: boolean;
    message?: string;
    allowEmpty?: boolean;
    verbose?: boolean;
    quiet?: boolean;
  } & RunOptions,
) {
  return runCommand(
    "commit",
    [],
    Cmd.schema({ message: Cmd.string(), allowEmpty: Cmd.boolean(), all: Cmd.boolean() }),
    deepMerge(logByDefault, options),
  );
}

/**
 * `git status`
 *
 * See: https://git-scm.com/docs/git-status.
 */
export async function status(options?: RunOptions): Promise<StatusEntry[]> {
  const result = await runCommand(
    "status",
    [], // args
    {}, // commandSchema
    { ...deepMerge(options, withOutErr), porcelain: true, nullTerminated: true },
  );
  const lines = splitOutput(result.stdout!, true /* nullTerminated */);
  return lines.map((line) => line);
}

export async function branchList(
  options?: Cmd.Data<typeof branchSchema> & RunOptions,
): Promise<string[]> {
  const result = await runCommand(
    "branch",
    ["--list"],
    branchSchema,
    deepMerge(options, withOutErr),
  );
  return splitOutput(result.stdout!);
}

export async function commitExists(hash: string, options?: RunOptions) {
  const result = await catFile(`${hash}^{commit}`, {
    ...deepMerge(options, withOutErr, noCheck),
    exists: true,
  });
  if (result.exitCode === 128) return false;
  result.check();
  return true;
}

export async function commitExistsOnRemote(commit: string, options?: RunOptions): Promise<boolean> {
  const branches = await branchList({ ...options, remotes: true, contains: commit });
  return branches.length > 0;
}

interface RevParseOptions {
  /**
   * If true raise exception if invalid object name is provided, otherwise just return undefined.
   */
  check?: boolean;
  /**
   * Verify that exactly one parameter is provided, and that it can be turned into a raw 20-byte
   * SHA-1 that can be used to access the object database. If so, emit it to the standard output;
   * otherwise, error out.
   */
  verify?: boolean;
  /**
   * Only meaningful in --verify mode. Do not output an error message if the first argument is not a
   * valid object name; instead exit with non-zero status silently. SHA-1s for valid object names
   * are printed to stdout on success.
   */
  quiet?: boolean;
}

/**
 * Git rev-parse
 *
 * See {@link https://git-scm.com/docs/git-rev-parse}.
 */
export async function revParse(
  args: string | string[],
  options: RevParseOptions & { check: true } & RunOptions,
): Promise<string>;
export async function revParse(
  args: string | string[],
  options?: RevParseOptions & { check?: boolean | undefined } & RunOptions,
): Promise<string | undefined>;
export async function revParse(args: string | string[], options?: RevParseOptions & RunOptions) {
  const runOptions: Subprocess.RunOptions = options?.check
    ? { check: true }
    : { check: true, allowedExitCodes: [0, 1] };
  const result = await runCommand(
    "rev-parse",
    typeof args === "string" ? [args] : args,
    { verify: Cmd.boolean() },
    deepMerge(options, withOut, { run: runOptions }),
  );
  if (result.exitCode === 1) return undefined;
  return result.stdout!.trimEnd();
}

export async function revParseHead(options?: RunOptions) {
  return revParse("HEAD", { ...options, check: true, verify: true, quiet: true });
}

/**
 * `git checkout`
 *
 * See: https://www.git-scm.com/docs/git-checkout
 */
export async function checkout(
  args: string | string[],
  options?: { quiet?: boolean } & Cmd.Data<typeof checkoutSchema> & RunOptions,
) {
  return runCommand(
    "checkout",
    typeof args === "string" ? [args] : args,
    checkoutSchema,
    deepMerge(logByDefault, options),
  );
}

/**
 * `git show`
 *
 * See: https://www.git-scm.com/docs/git-checkout
 */
export async function show(obj: string, options?: RunOptions) {
  return runCommand("show", [obj], {}, options);
}

export async function getBlob(hash: string, options?: RunOptions) {
  return (await show(hash, deepMerge(options, withOutErr))).stdoutBuffer!;
}

/**
 * `git fetch`
 *
 * See: https://www.git-scm.com/docs/git-fetch
 */
export async function fetch(
  args: string | string[],
  options?: {
    quiet?: boolean;
    verbose?: boolean;
  } & RunOptions,
) {
  return runCommand(
    "fetch",
    typeof args === "string" ? [args] : args,
    {},
    deepMerge(logByDefault, options),
  );
}

/**
 * `git reset`
 *
 * {@link https://git-scm.com/docs/git-reset}
 */
export async function reset(
  args: string | string[],
  options?: {
    quiet?: boolean;
  } & RunOptions,
) {
  return runCommand(
    "reset",
    typeof args === "string" ? [args] : args,
    {},
    deepMerge(logByDefault, options),
  );
}

/**
 * `git cat-file`
 *
 * See: https://www.git-scm.com/docs/git-cat-file
 */
export async function catFile(obj: string, options?: Cmd.Data<typeof catFileSchema> & RunOptions) {
  return runCommand("cat-file", [obj], catFileSchema, options);
}

/**
 * `git --version`
 *
 * Returns git version in semver format
 */
export async function version(options?: RunOptions) {
  const result = await runCommand(
    "version",
    [],
    {},
    deepMerge(options, { run: { stdout: "pipe" } }),
  );
  const verStr = result.stdout!.trimEnd();
  const match = verStr.match(/^git version ((\d+)\.(\d+)\.(\d+))/);
  if (!match) throw new ParseError("Failed to parse git version output: " + verStr);
  return match[1];
}

/**
 * `git push`
 *
 * See {@link https://git-scm.com/docs/git-push}.
 */
export async function push(
  args?: string | string[],
  options?: {
    /**
     * Suppress all output, including the listing of updated refs, unless an error occurs. Progress
     * is not reported to the standard error stream.
     */
    quiet?: boolean;

    verbose?: boolean;
    /**
     * Usually, the command refuses to update a remote ref that is not an ancestor of the local ref
     * used to overwrite it. Also, when --force-with-lease option is used, the command refuses to
     * update a remote ref whose current value does not match what is expected.
     *
     * This flag disables these checks, and can cause the remote repository to lose commits; use it
     * with care.
     *
     * See {@link https://git-scm.com/docs/git-push#Documentation/git-push.txt---force}.
     */
    force?: boolean;
    /**
     * Toggle the pre-push hook (see githooks[5]). The default is --verify, giving the hook a chance
     * to prevent the push. With --no-verify, the hook is bypassed completely.
     */
    verify?: boolean;
  } & RunOptions,
) {
  return runCommand(
    "push",
    args,
    {
      verify: Cmd.boolean({ invert: true, default: true }),
    },
    deepMerge(logByDefault, options),
  );
}

const branchSchema = Cmd.schema({
  remotes: Cmd.boolean(),
  contains: Cmd.string(),
});

const checkoutSchema = Cmd.schema({
  branch: Cmd.string({ custom: "-b" }),
  branchForce: Cmd.string({ custom: "-B" }),
  detach: Cmd.boolean(),
});

const catFileSchema = Cmd.schema({
  /** Just check if object exists */
  exists: Cmd.boolean({ custom: "-e" }),
});
