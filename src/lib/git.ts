import { assert } from "@sergei-dyshel/typescript/error";
import * as Cmd from "./cmdline-builder";
import { Runner, type RunnerOptions } from "./runner";
import { Stdio, type SubprocessRunOptions } from "./subprocess";

export interface GitOptions {
  /** Use existing runner */
  runner?: Runner;

  /** Options for new runner if {@link runner} is not provided */
  runnerOptions?: RunnerOptions;

  /** Override {@link RunnerOptions.cwd} */
  cwd?: string;
}

export interface GitStatusEntry {
  // TODO:
}

const commonSchema = Cmd.schema({
  porcelain: Cmd.boolean(),
  nullTerminated: Cmd.boolean({ custom: "-z" }),
});

const withOut = {
  stdout: Stdio.PIPE,
};

const withOutErr = {
  ...withOut,
  stderr: Stdio.PIPE,
};

export type GitCommandOptions = Cmd.Data<typeof commonSchema>;

const branchSchema = Cmd.extend(commonSchema, {
  remotes: Cmd.boolean(),
  contains: Cmd.string(),
});

export class Git {
  options: GitOptions;
  readonly runner: Runner;

  constructor(options?: GitOptions) {
    this.options = options || {};
    this.runner = options?.runner || new Runner();
    this.runner.mergeOptions({ cwd: options?.cwd });
  }

  private async run(args: string[], runOptions?: SubprocessRunOptions) {
    return this.runner.run(["git", ...args], runOptions);
  }

  async runCommand<S extends Cmd.Schema>(
    command: string,
    args: string[],
    commandSchema?: S,
    options?: Cmd.Data<S> & GitCommandOptions & { runOptions?: SubprocessRunOptions },
  ) {
    return this.run(
      [command, ...Cmd.build(Cmd.extend(commonSchema, commandSchema), options), ...args],
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
