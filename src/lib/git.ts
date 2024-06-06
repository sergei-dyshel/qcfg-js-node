import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { LoggableError, assert } from "@sergei-dyshel/typescript/error";
import type { PlainObject } from "@sergei-dyshel/typescript/types";
import gitUrlParse, { type GitUrl } from "git-url-parse";
import { join } from "path";
import * as Cmd from "./cmdline-builder";
import { pathExists } from "./filesystem";
import { Runner, type RunnerOptions } from "./runner";
import type { SubprocessRunOptions } from "./subprocess";

// TODO:
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface GitStatusEntry {}

/** Command schema with git options common for multiple commands. */
const commonSchema = Cmd.schema({
  quiet: Cmd.boolean(),
  porcelain: Cmd.boolean(),
  nullTerminated: Cmd.boolean({ custom: "-z" }),
});

export type GitCommandOptions = Cmd.Data<typeof commonSchema>;

const branchSchema = Cmd.extend(commonSchema, {
  remotes: Cmd.boolean(),
  contains: Cmd.string(),
});

export type GitRemoteList = Record<string, { push?: GitUrl; fetch?: GitUrl }>;

/** Error parsing git output */
export class GitParseError extends LoggableError {}

/** Git command failed with non-zero exit code */
export class GitRunError extends LoggableError {}

/**
 * Run git commands.
 *
 * All commands are divide into two categories:
 *
 * - Non-destrucive (i.e. querying) commands query state. Their stdout/stderr is captured and parsed
 *   accordingly. Command invocations are not logged by default.
 * - Destructive commands modify state. Their output is discarded therefore one decide if pipe it or
 *   redirect to stdout/stderr.
 */
export class Git {
  readonly runner: Runner;
  readonly cwd?: string;

  constructor(options?: {
    /** Use existing runner */
    runner?: Runner;

    /** Options for new runner if {@link runner} is not provided */
    runnerOptions?: RunnerOptions;

    /** Override {@link RunnerOptions.cwd} */
    cwd?: string;
  }) {
    this.cwd = options?.cwd;
    this.runner = options?.runner ?? new Runner(options?.runnerOptions);
    this.runner.mergeOptions({ cwd: options?.cwd, check: true });
  }

  /**
   * Current directory is git repo root, i.e. contains .git file/directory
   *
   * NOTE: Doesn't check if it's VALID repo
   */
  async isRepoRoot() {
    return pathExists(join(this.cwd ?? ".", ".git"));
  }

  /**
   * Create an empty Git repository or reinitialize an existing one
   *
   * https://git-scm.com/docs/git-init
   */
  async init(options?: { initialBranch?: string }) {
    return this.runCommand(
      "init",
      [],
      Cmd.schema({ initialBranch: Cmd.string() }),
      logByDefault(options),
    );
  }

  /**
   * Git remote add <name> <url>
   *
   * https://git-scm.com/docs/git-remote#Documentation/git-remote.txt-emaddem
   */
  async remoteAdd(name: string, url: string, options?: { runOptions?: SubprocessRunOptions }) {
    return this.runCommand(["remote", "add"], [name, url], {}, logByDefault(options));
  }

  async remoteList() {
    const result = await this.runCommand(
      ["remote", "--verbose"],
      [],
      {},
      { runOptions: withOutErr },
    );
    return parseGitRemoteVerbose(result.stdout!);
  }

  private async run(args: string[], runOptions?: SubprocessRunOptions) {
    try {
      return await this.runner.run(["git", ...args], runOptions);
    } catch (err) {
      throw new GitRunError("Git command failed", { cause: err });
    }
  }

  private async runCommand<S extends Cmd.Schema>(
    command: string | string[],
    args: string[],
    commandSchema?: S,
    options?: Cmd.Data<S> & GitCommandOptions & { runOptions?: SubprocessRunOptions },
  ) {
    return this.run(
      [
        ...(typeof command === "string" ? [command] : command),
        ...Cmd.build(Cmd.extend(commonSchema, commandSchema), options),
        ...args,
      ],
      options?.runOptions,
    );
  }

  async status(): Promise<GitStatusEntry[]> {
    const result = await this.runCommand(
      "status",
      [], // args
      {}, // commandSchema
      {
        porcelain: true,
        nullTerminated: true,
        runOptions: withOutErr,
      },
    );
    const lines = splitOutput(result.stdout!, true /* nullTerminated */);
    return lines.map((_) => ({}) as GitStatusEntry);
  }

  async branchList(options?: Cmd.Data<typeof branchSchema>): Promise<string[]> {
    const result = await this.runCommand("branch", ["--list"], branchSchema, {
      ...options,
      runOptions: withOut,
    });
    return splitOutput(result.stdout!);
  }

  async commitExistsOnRemote(commit: string): Promise<boolean> {
    const branches = await this.branchList({ remotes: true, contains: commit });
    return branches.length > 0;
  }

  async revParseHead(): Promise<string> {
    const result = await this.runCommand(
      "rev-parse",
      ["HEAD"],
      {},
      {
        runOptions: withOut,
      },
    );
    return result.stdout!.trimEnd();
  }
}

function splitOutput(output: string, nullTerminated = false): string[] {
  const lines = output.split(nullTerminated ? "\0" : "\n");
  assert(
    lines[lines.length - 1] === "",
    "Git output is supposed to end with delimiter character",
    output,
  );
  lines.pop();
  return lines;
}

const withOut = {
  stdout: "pipe",
} as const;

const withOutErr = {
  ...withOut,
  stderr: "pipe",
} as const;

/** Modify run options to enable logging if not disabled in runner */
function logByDefault<T extends PlainObject & { runOptions?: SubprocessRunOptions }>(options?: T) {
  const runOptions: RunnerOptions = { log: { shouldLog: true } };
  return deepMerge<T>(options, { runOptions } as unknown as T);
}

function parseGitRemoteVerbose(output: string) {
  const result: GitRemoteList = {};
  const lines = splitOutput(output);
  for (const line of lines) {
    const match = /^(\S+)\s+(\S+)\s+\((\S+)\)$/.exec(line);
    if (!match) throw new GitParseError("Failed to parse git remote output line: " + line);
    const [_, name, uriStr, type] = match;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!result[name]) result[name] = {};
    let uri: GitUrl;
    try {
      uri = gitUrlParse(uriStr);
    } catch (err) {
      throw new GitParseError("Failed to parse git remote URI: " + uriStr, { cause: err });
    }
    switch (type) {
      case "push":
        result[name].push = uri;
        continue;
      case "fetch":
        result[name].fetch = uri;
        continue;
    }
    throw new GitParseError("Unknown git remote type: " + type);
  }
  return result;
}
