import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { LoggableError, assert, assertNotNull } from "@sergei-dyshel/typescript/error";
import type { PlainObject } from "@sergei-dyshel/typescript/types";
import gitUrlParse, { type GitUrl } from "git-url-parse";
import { join } from "path";
import * as Cmd from "./cmdline-builder";
import { pathExists } from "./filesystem";
import { Runner, type RunnerOptions } from "./runner";
import type { SubprocessRunOptions } from "./subprocess";

export function gitShortHash(hash: string) {
  return hash.substring(0, 8);
}

type LogFieldType<T extends string> = T extends `${string}Date` ? Date : string;
export type GitLogEntry = { [K in keyof typeof LOG_FORMAT]: LogFieldType<K> };

// TODO:
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface GitStatusEntry {}

export type GitCommandOptions = Cmd.Data<typeof commonSchema>;

export type GitRemoteList = Record<string, { push?: GitUrl; fetch?: GitUrl }>;

/** Error parsing git output */
export class GitParseError extends LoggableError {}

/** Git command failed with non-zero exit code */
export class GitRunError extends LoggableError {}

/** Errors related to git config invocations */
export class GitConfigError extends LoggableError {}

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

  /**
   * `git add`
   *
   * https://www.git-scm.com/docs/git-add
   */
  async add(pathspecs: string | string[], options?: { runOptions?: RunnerOptions }) {
    return this.runCommand(
      "add",
      typeof pathspecs === "string" ? [pathspecs] : pathspecs,
      {},
      logByDefault(options),
    );
  }

  /**
   * `git commit`
   *
   * https://git-scm.com/docs/git-commit
   */
  async commit(options?: { message?: string; runOptions?: RunnerOptions }) {
    return this.runCommand(
      "commit",
      [],
      Cmd.schema({ message: Cmd.string() }),
      logByDefault(options),
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

  /**
   * `git log`
   *
   * https://git-scm.com/docs/git-log
   *
   * This command only runs `git log` without parsing. For parsing use {@link parseLog}
   */
  async log(options?: {
    format?: string;
    date?: string;
    nullTerminated?: boolean;
    runOptions?: RunnerOptions;
  }) {
    return this.runCommand(
      "log",
      [],
      Cmd.schema({ format: Cmd.string({ equals: true }), date: Cmd.string({ equals: true }) }),
      options,
    );
  }

  /** Run {@link log} and parse output. */
  async parseLog(): Promise<GitLogEntry[]> {
    const keys = Object.keys(LOG_FORMAT);
    const formatStr = Object.values(LOG_FORMAT).join("%x01");
    const output = (
      await this.log({
        format: `format:${formatStr}`,
        nullTerminated: true,
        runOptions: withOutErr,
      })
    ).stdout!;
    return output.split("\0").map((commitOut) => {
      const fields = commitOut.split("\x01");
      assert(fields.length === keys.length);
      return Object.fromEntries(
        keys.map((key, i) => [key, key.endsWith("Date") ? new Date(fields[i]) : fields[i]]),
      ) as GitLogEntry;
    });
  }

  /**
   * `git config --get`
   *
   * See: https://git-scm.com/docs/git-config
   *
   * @param check If `true` throws an error if key is not found, otherwise returns `undefined`
   * @returns Config value as string (but type can be enforced with
   *   {@link ConfigOptionsWithType["type"]}) or `undefined` if key is not found and `check` is
   *   `false`}
   */
  async configGet(
    key: string,
    options?: ConfigOptionsWithType & { check?: boolean },
  ): Promise<string | undefined>;
  async configGet(key: string, options?: ConfigOptionsWithType & { check?: true }): Promise<string>;
  async configGet(key: string, options?: ConfigOptionsWithType & { check?: boolean }) {
    const result = await this.runCommand("config", ["--get", key], configSchema, {
      ...options,
      runOptions: { ...withOutErr, ...noCheck },
    });
    if (result.exitCode == 1) {
      if (options?.check) throw new GitConfigError("Git config key not found: " + key);
      return undefined;
    }
    result.check();
    return result.stdout!.trimEnd();
  }

  /** Like {@link configGet} but force boolean type with `--type`. */
  async configGetBool(
    key: string,
    options?: ConfigOptions & { check?: false },
  ): Promise<boolean | undefined>;
  async configGetBool(key: string, options?: ConfigOptions & { check: true }): Promise<boolean>;
  async configGetBool(key: string, options?: ConfigOptions & { check?: boolean }) {
    const val = await this.configGet(key, { ...options, type: "bool" });
    return val === undefined ? undefined : Boolean(val);
  }

  /** Like {@link configGet} but force integer type with `--type`. */
  async configGetInt(
    key: string,
    options?: ConfigOptions & { check?: false },
  ): Promise<number | undefined>;
  async configGetInt(key: string, options?: ConfigOptions & { check: true }): Promise<number>;
  async configGetInt(key: string, options?: ConfigOptions & { check?: boolean }) {
    const val = await this.configGet(key, { ...options, type: "int" });
    return val === undefined ? undefined : Number(val);
  }

  /**
   * Like {@link configGet} but if key not defined return default value. The type of returned value
   * is force with `--type` and matches type of default value.
   */
  async configGetDefault<T extends ConfigValue>(
    key: string,
    defaultValue: ConfigValue,
    options?: Omit<ConfigOptions, "type" | "default">,
  ): Promise<T> {
    const str = await this.configGet(key, {
      ...options,
      type: configValueType(defaultValue),
      default: String(defaultValue),
    });
    assertNotNull(str);
    return (
      typeof defaultValue === "boolean"
        ? Boolean(str)
        : typeof defaultValue === "number"
          ? Number(str)
          : str
    ) as T;
  }

  /**
   * Set config value.
   *
   * See: https://git-scm.com/docs/git-config
   *
   * @param value If undefined then {@link configUnset} is called to delete value.
   */
  async configSet(
    key: string,
    value: ConfigValue | undefined,
    options?: Omit<ConfigOptions, "default">,
  ) {
    if (value === undefined) return this.configUnset(key, options);
    return this.runCommand(
      ["config"],
      [key, String(value)],
      configSchema,
      logByDefault({
        ...options,
        type: configValueType(value),
        runOptions: { ...withOutErr },
      }),
    );
  }

  async configUnset(key: string, options?: Omit<ConfigOptions, "default">) {
    return this.runCommand(
      ["config"],
      ["--unset", key],
      configSchema,
      logByDefault({
        ...options,
        runOptions: { ...withOutErr },
      }),
    );
  }

  async setUser(name: string, email: string, options?: Omit<ConfigOptions, "default">) {
    await this.configSet("user.name", name, options);
    await this.configSet("user.email", email, options);
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

  private async run(args: string[], runOptions?: SubprocessRunOptions) {
    try {
      return await this.runner.run(["git", ...args], runOptions);
    } catch (err) {
      throw GitRunError.wrap(err, "Git command failed");
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

const noCheck = {
  check: false,
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

const LOG_FORMAT = {
  hash: "%H",
  authorName: "%an",
  authorEmail: "%ae",
  authorDate: "%aI",
  subject: "%s",
  body: "%b",
  committerName: "%cn",
  committerEmail: "%ce",
  committerDate: "%cI",
} as const;

/** Supported config types */
type ConfigValue = string | number | boolean;

function configValueType(value: ConfigValue) {
  return typeof value === "boolean" ? "bool" : typeof value === "number" ? "int" : undefined;
}

/**
 * Command schema with git options common for multiple commands.
 *
 * @internal
 */
const commonSchema = Cmd.schema({
  quiet: Cmd.boolean(),
  porcelain: Cmd.boolean(),
  nullTerminated: Cmd.boolean({ custom: "-z" }),
});

const branchSchema = Cmd.extend(commonSchema, {
  remotes: Cmd.boolean(),
  contains: Cmd.string(),
});

const configSchema = Cmd.schema({
  global: Cmd.boolean(),
  local: Cmd.boolean(),
  type: Cmd.string(),
  default: Cmd.string(),
});

type ConfigOptions = Cmd.Data<typeof configSchema>;
type ConfigOptionsWithType = ConfigOptions & { type?: "bool" | "int" };
