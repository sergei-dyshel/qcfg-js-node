import { normalizeArray } from "@sergei-dyshel/typescript/array";
import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import type { AnyFunction } from "@sergei-dyshel/typescript/types";
import { Subprocess } from "..";
import * as Cmd from "../cmdline-builder";
import { exists } from "../filesystem";
import { pathJoin } from "../path";
import { logRun } from "../subprocess";
import {
  Error,
  HEAD,
  internalRun,
  logByDefault,
  noCheck,
  preCmdSchema,
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
import * as RevParse from "./rev-parse";

export { Config, Diff, Error, HEAD, Log, Remote, RevParse, type RunOptions };

export const DEFAULT_GIT_DIR = ".git";

// TODO: implement parsing for git status
export type StatusEntry = string;

export class Instance {
  constructor(readonly options?: RunOptions) {}

  run = this.wrap(run);
  runTool = this.wrap(runTool);

  init = this.wrap(init);
  clone = this.wrap(clone);
  add = this.wrap(add);
  rm = this.wrap(rm);
  checkIgnore = this.wrap(checkIgnore);
  isIgnored = this.wrap(isIgnored);
  commit = this.wrap(commit);
  status = this.wrap(status);
  branchList = this.wrap(branchList);
  commitExists = this.wrap(commitExists);
  commitExistsOnRemote = this.wrap(commitExistsOnRemote);
  checkout = this.wrap(checkout);
  getBlob = this.wrap(getBlob);
  fetch = this.wrap(fetch);
  reset = this.wrap(reset);
  catFile = this.wrap(catFile);
  version = this.wrap(version);
  show = this.wrap(show);
  push = this.wrap(push);
  mergeBase = this.wrap(mergeBase);
  inAncestor = this.wrap(isAncestor);

  revParseRaw = this.wrap(RevParse.raw);
  revParse = this.wrap(RevParse.hash);
  revParseHead = this.wrap(RevParse.head);
  showToplevel = this.wrap(RevParse.showToplevel);
  resolveGitDir = this.wrap(RevParse.resolveGitDir);

  getConfig = this.wrap(Config.get);
  getConfigCustom = this.wrap(Config.getCustom);
  setConfig = this.wrap(Config.set);
  setConfigCustom = this.wrap(Config.setCustom);
  unsetConfigCustom = this.wrap(Config.unsetCustom);
  unsetConfig = this.wrap(Config.unset);
  setUser = this.wrap(Config.setUser);
  setConfigRemote = this.wrap(Config.Remote.set);
  getConfigRemote = this.wrap(Config.Remote.get);

  remoteAdd = this.wrap(Remote.add);
  remoteList = this.wrap(Remote.list);
  remoteRename = this.wrap(Remote.rename);

  diffRaw = this.wrap(Diff.raw);
  diffParse = this.wrap(Diff.parse);

  logRaw = this.wrap(Log.raw);
  logParse = this.wrap(Log.parse);

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
 * Run arbitrary git command.
 *
 * Args should start with git command, e.g. `["commit", "-m", "message"]` Common args are
 * automatically prepended based on options.
 */
export async function run(args: string[], options?: RunOptions) {
  logRun(["git", ...args], options?.log);
  return internalRun([...Cmd.build(preCmdSchema, options), ...args], options);
}

/**
 * Run arbitrary git tool.
 *
 * Properly sets environment variables GIT_DIR and GIT_WORK_TREE based on options.
 */
export async function runTool(args: string[], options?: RunOptions) {
  const env: NodeJS.ProcessEnv = {};

  // See https://git-scm.com/book/ms/v2/Git-Internals-Environment-Variables
  if (options?.workTree) env["GIT_WORK_TREE"] = options.workTree;
  if (options?.gitDir) env["GIT_DIR"] = options.gitDir;
  const runner = options?.runner ?? Subprocess.run;
  return runner(args, deepMerge(options?.run, { env }));
}

/**
 * Current directory is git repo root, i.e. contains .git file/directory
 *
 * NOTE: Doesn't check if it's VALID repo
 *
 * FIXME: Does not use runner, so only can be used for local paths
 */
export async function isRepoRoot(options?: RunOptions & { gitDirName?: string }) {
  return exists(pathJoin(options?.cwd, options?.gitDirName ?? ".git"));
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
 * `git rm`
 *
 * See {@link https://git-scm.com/docs/git-rm}.
 */
export async function rm(
  pathspecs: string | string[],
  options?: {
    /**
     * Use this option to unstage and remove paths only from the index. Working tree files, whether
     * modified or not, will be left alone.
     */
    cached?: boolean;
    /** Exit with a zero status even if no files matched. */
    ignoreUnmatch?: boolean;
    /**
     * Git rm normally outputs one line (in the form of an rm command) for each file removed. This
     * option suppresses that output.
     */
    quiet?: boolean;
    /** Allow recursive removal when a leading directory name is given. */
    recursive?: boolean;
  } & RunOptions,
) {
  return runCommand(
    "rm",
    normalizeArray(pathspecs),
    {
      cached: Cmd.boolean(),
      ignoreUnmatch: Cmd.boolean(),
      recursive: Cmd.boolean({ custom: "-r" }),
    },
    deepMerge(logByDefault, options),
  );
}

/**
 * `git check-ignore`
 *
 * Exit status:
 *
 * - 0 - One or more of the provided paths is ignored.
 * - 1 - None of the provided paths are ignored.
 * - 128 - A fatal error was encountered.
 *
 * See {@link https://git-scm.com/docs/git-check-ignore}.
 */
export async function checkIgnore(
  paths: string | string[],
  options?: {
    /** Don’t output anything, just set exit status. This is only valid with a single pathname. */
    quiet?: boolean;
    /**
     * Instead of printing the paths that are excluded, for each path that matches an exclude
     * pattern, print the exclude pattern together with the path.
     */
    verbose?: boolean;
  } & RunOptions,
) {
  return runCommand("check-ignore", normalizeArray(paths), {}, deepMerge(options, withOut));
}

/**
 * Check if path is ignored.
 *
 * Uses {@link checkIgnore}.
 */
export async function isIgnored(path: string, options?: RunOptions) {
  const result = await checkIgnore(path, deepMerge(options, { run: { allowedExitCodes: [0, 1] } }));
  return result.exitCode === 0;
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
    /** Replace the tip of the current branch by creating a new commit */
    amend?: boolean;
    verbose?: boolean;
    quiet?: boolean;
  } & RunOptions,
) {
  return runCommand(
    "commit",
    [],
    Cmd.schema({
      message: Cmd.string(),
      allowEmpty: Cmd.boolean(),
      all: Cmd.boolean(),
      amend: Cmd.boolean(),
    }),
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
  if (!match) throw new Error.Parse("Failed to parse git version output: " + verStr);
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

/**
 * `git merge-base`
 *
 * See {@link https://git-scm.com/docs/git-merge-base}.
 */
export async function mergeBase(
  args: string[],
  options?: {
    /**
     * Check if the first <commit> is an ancestor of the second <commit>, and exit with status 0 if
     * true, or with status 1 if not. Errors are signaled by a non-zero status that is not 1.
     */
    isAncestor?: boolean;
  } & RunOptions,
) {
  return runCommand(
    "merge-base",
    args,
    Cmd.schema({ isAncestor: Cmd.boolean() }),
    deepMerge<RunOptions>(withOut, options),
  );
}

/**
 * `git merge-base --is-ancestor`
 *
 * Returns if <commit1> is an ancestor of <commit2>.
 *
 * See
 * {@link https://git-scm.com/docs/git-merge-base#Documentation/git-merge-base.txt---is-ancestor}.
 */
export async function isAncestor(commit1: string, commit2: string, options?: RunOptions) {
  const result = await mergeBase(
    [commit1, commit2],
    deepMerge(options, { run: { allowedExitCodes: [0, 1] } }),
  );
  return result.exitCode === 0;
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
