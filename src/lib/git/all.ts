import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { join } from "node:path";
import * as Cmd from "../cmdline-builder";
import { pathExists } from "../filesystem";
import {
  logByDefault,
  noCheck,
  runCommand,
  splitOutput,
  withOut,
  withOutErr,
  type RunOptions,
} from "./common";

export * as Config from "./config";
export * as Diff from "./diff";
export * as Log from "./log";
export * as Remote from "./remote";

export { type RunOptions };

// TODO: implement parsing for git status
export type StatusEntry = string;

/**
 * Current directory is git repo root, i.e. contains .git file/directory
 *
 * NOTE: Doesn't check if it's VALID repo
 */
export async function isRepoRoot(options?: RunOptions) {
  return pathExists(join(options?.cwd ?? ".", ".git"));
}

/**
 * Create an empty Git repository or reinitialize an existing one
 *
 * https://git-scm.com/docs/git-init
 */
export async function init(options?: { initialBranch?: string } & RunOptions) {
  return runCommand(
    "init",
    [],
    Cmd.schema({ initialBranch: Cmd.string() }),
    deepMerge(options, logByDefault),
  );
}

/**
 * `git add`
 *
 * https://www.git-scm.com/docs/git-add
 */
export async function add(pathspecs: string | string[], options?: RunOptions) {
  return runCommand(
    "add",
    typeof pathspecs === "string" ? [pathspecs] : pathspecs,
    {},
    deepMerge(options, logByDefault),
  );
}

/**
 * `git commit`
 *
 * https://git-scm.com/docs/git-commit
 */
export async function commit(options?: { message?: string } & RunOptions) {
  return runCommand(
    "commit",
    [],
    Cmd.schema({ message: Cmd.string() }),
    deepMerge(options, logByDefault),
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

export async function commitExistsOnRemote(commit: string, options?: RunOptions): Promise<boolean> {
  const branches = await branchList({ ...options, remotes: true, contains: commit });
  return branches.length > 0;
}

export async function revParseHead(options?: RunOptions): Promise<string> {
  const result = await runCommand("rev-parse", ["HEAD"], {}, deepMerge(options, withOut));
  return result.stdout!.trimEnd();
}

/**
 * `git checkout`
 *
 * See: https://www.git-scm.com/docs/git-checkout
 */
export async function checkout(
  args: string | string[],
  options?: Cmd.Data<typeof checkoutSchema> & RunOptions,
) {
  return runCommand(
    "checkout",
    typeof args === "string" ? [args] : args,
    checkoutSchema,
    deepMerge(options, logByDefault),
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
export async function fetch(args: string | string[], options?: RunOptions) {
  return runCommand(
    "fetch",
    typeof args === "string" ? [args] : args,
    {},
    deepMerge(options, logByDefault),
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

export async function commitExists(hash: string, options?: RunOptions) {
  const result = await catFile(`${hash}^{commit}`, {
    ...deepMerge(options, withOutErr, noCheck),
    exists: true,
  });
  if (result.exitCode === 128) return false;
  result.check();
  return true;
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
