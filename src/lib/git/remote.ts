/** @file Working with Git remotes */

import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import gitUrlParse, { type GitUrl } from "git-url-parse";
import {
  Error,
  logByDefault,
  runCommand,
  splitOutput,
  withOutErr,
  type RunOptions,
} from "./common";

export type List = Record<string, { push?: GitUrl; fetch?: GitUrl }>;

/**
 * `git remote add <name> <url>`
 *
 * https://git-scm.com/docs/git-remote#Documentation/git-remote.txt-emaddem
 */
export async function add(name: string, url: string, options?: RunOptions) {
  return runCommand(["remote", "add"], [name, url], {}, deepMerge(logByDefault, options));
}

/**
 * `git remote remove <name>`
 */
export async function remove(name: string, options?: RunOptions) {
  return runCommand(["remote", "remove"], [name], {}, deepMerge(logByDefault, options));
}

/**
 * List remotes.
 *
 * Parses output.
 */
export async function list(options?: RunOptions) {
  const result = await runCommand(["remote", "--verbose"], [], {}, deepMerge(options, withOutErr));
  return parseGitRemoteVerbose(result.stdout!);
}

/**
 * Rename remote.
 */
export async function rename(oldName: string, newName: string, options?: RunOptions) {
  return runCommand(
    ["remote", "rename", oldName, newName],
    [],
    {},
    deepMerge(logByDefault, options),
  );
}

function parseGitRemoteVerbose(output: string) {
  const result: List = {};
  const lines = splitOutput(output);
  for (const line of lines) {
    const match = /^(\S+)\s+(\S+)\s+\((\S+)\)/.exec(line);
    if (!match) throw new Error.Parse("Failed to parse git remote output line: " + line);
    const [_, name, uriStr, type] = match;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!result[name]) result[name] = {};
    let uri: GitUrl;
    try {
      uri = gitUrlParse(uriStr);
    } catch (err) {
      throw new Error.Parse("Failed to parse git remote URI: " + uriStr, { cause: err });
    }
    switch (type) {
      case "push":
        result[name].push = uri;
        continue;
      case "fetch":
        result[name].fetch = uri;
        continue;
    }
    throw new Error.Parse("Unknown git remote type: " + type);
  }
  return result;
}
