import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import type { Subprocess } from "..";
import * as Cmd from "../cmdline-builder";
import { Error, HEAD, noCheck, runCommand, type RunOptions, withOut, withOutErr } from "./common";

export interface Options {
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

  /**
   * Controls the behavior of certain other options. If specified as absolute, the paths printed by
   * those options will be absolute and canonical. If specified as relative, the paths will be
   * relative to the current working directory if that is possible. The default is option specific.
   */
  pathFormat?: "absolute" | "relative";

  //
  // Mutually exclusive options for returning various directories
  //
  /**
   * Check if <path> is a valid repository or a gitfile that points at a valid repository, and print
   * the location of the repository. If <path> is a gitfile then the resolved path to the real
   * repository is printed.
   */
  resolveGitDir?: string;

  /**
   * Show the (by default, absolute) path of the top-level directory of the working tree. If there
   * is no working tree, report an error.
   */
  showToplevel?: boolean;
}

/**
 * `git rev-parse`
 *
 * See {@link https://git-scm.com/docs/git-rev-parse}.
 *
 * This "raw" version of the command, that does not parse or interpret output in any way. Most
 * common usage of `rev-parse` is to get hash for object/reference. For that use {@link hash}.
 */

export async function raw(args?: string | string[], options?: Options & RunOptions) {
  return await runCommand(
    "rev-parse",
    typeof args === "string" ? [args] : args,
    {
      verify: Cmd.boolean(),
      resolveGitDir: Cmd.string(),
      pathFormat: Cmd.string(),
      showToplevel: Cmd.boolean(),
    },
    options,
  );
}

/**
 * Wrapper for {@link raw} that works for command variants that dump object/commit hash.
 */
export async function hash(
  args: string | string[],
  options: Options & { check: true } & RunOptions,
): Promise<string>;
export async function hash(
  args: string | string[],
  options?: Options & { check?: boolean | undefined } & RunOptions,
): Promise<string | undefined>;
export async function hash(
  args: string | string[],
  options?: Options & { check?: boolean } & RunOptions,
) {
  const runOptions: Subprocess.RunOptions = options?.check
    ? { check: true }
    : { check: true, allowedExitCodes: [0, 1] };
  const result = await raw(args, deepMerge(options, withOut, { run: runOptions }));
  if (result.exitCode === 1) return undefined;
  return result.stdout!.trimEnd();
}

export async function head(options?: RunOptions) {
  return hash(HEAD, { ...options, check: true, verify: true, quiet: true });
}

/**
 * `git rev-parse --show-toplevel`
 *
 * Show the (by default, absolute) path of the top-level directory of the working tree. If there is
 * no working tree, report an error.
 *
 * See {@link raw}.
 */
export async function showToplevel(options?: RunOptions & Pick<Options, "pathFormat">) {
  const result = await raw(
    undefined,
    deepMerge<Options & RunOptions>(
      { ...options, showToplevel: true },
      { run: { check: false } },
      withOutErr,
    ),
  );
  if (result.exitCode === 0) return result.stdout!.trimEnd();
  if (result.exitCode === 128 && result.stderr!.includes("fatal: not a git repository"))
    throw new Error.NotAGitRepo(
      `Directory is not inside git worktree: ${options?.cwd ?? process.cwd()}`,
      { cause: result.checkError() },
    );
  throw result.checkError();
}

/**
 * `git rev-parse --resolve-git-dir <dir>`
 *
 * Check if <path> is a valid repository or a gitfile that points at a valid repository, and print
 * the location of the repository. If <path> is a gitfile then the resolved path to the real
 * repository is printed.
 *
 * See {@link raw}.
 */
export async function resolveGitDir(
  dir: string,
  options?: RunOptions & Pick<Options, "pathFormat">,
) {
  const result = await raw(
    undefined,
    deepMerge<Options & RunOptions>({ ...options, resolveGitDir: dir }, noCheck, withOutErr),
  );
  if (result.exitCode === 0) return result.stdout!.trimEnd();
  if (result.exitCode === 128 && result.stderr!.includes("fatal: not a gitdir"))
    throw new Error.NotAGitDir(`Directory is not a git dir: ${dir}`, { cause: result });
  throw result.checkError();
}

/**
 * `git rev-parse --git-dir`
 *
 * Works properly with submodules. From docs:
 *
 * Show $GIT_DIR if defined. Otherwise show the path to the .git directory. The path shown, when
 * relative, is relative to the current working directory.
 *
 * If $GIT_DIR is not defined and the current directory is not detected to lie in a Git repository
 * or work tree print a message to stderr and exit with nonzero status.
 *
 * {@link https://git-scm.com/docs/git-rev-parse#Documentation/git-rev-parse.txt---git-dir}
 */
export async function gitDir(options?: RunOptions) {
  const result = await raw("--git-dir", deepMerge<Options & RunOptions>(options, withOut));
  return result.stdout!.trimEnd();
}
