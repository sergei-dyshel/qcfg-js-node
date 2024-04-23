import * as cp from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as consumers from "node:stream/consumers";
import { shlex } from "./shlex";

/**
 * @file
 * Wrapper over Node's `child_process` that more resembles Python's subprocess
 * module.
 */

type Command = string | string[];

export enum Stdio {
  PIPE = "pipe",
  IGNORE = "ignore",
}

export interface RunOptions extends cp.SpawnOptionsWithoutStdio {
  stdin?: Stdio | Readable;
  stdout?: Stdio | Writable;
  stderr?: Stdio | Writable;

  check?: boolean;
}

export class SpawnError extends Error {
  constructor(
    public readonly command: Command,
    public readonly options: RunOptions | undefined,
    err: unknown,
  ) {
    super("Unable to spawn process", { cause: err });
  }
}

export class RunResult {
  constructor(
    public readonly command: Command,
    public readonly options: RunOptions | undefined,
    public readonly process: cp.ChildProcess,
    public readonly stdout: string | undefined,
    public readonly stderr: string | undefined,
  ) {}

  get exitCode() {
    return this.process.exitCode;
  }

  get signalCode() {
    return this.process.signalCode;
  }

  checkError() {
    return new CheckError(this);
  }

  check() {
    if (this.signalCode || this.exitCode != 0) throw this.checkError();
  }
}

export class CheckError extends Error {
  constructor(public readonly result: RunResult) {
    const cmd = typeof result.command === "string" ? result.command : shlex.join(result.command);
    const reason = result.signalCode
      ? `was killed by signal ${result.signalCode}`
      : `exited with code ${result.exitCode}`;
    super(`Command '${cmd}' ${reason}`);
  }
}

/**
 * Wraps over {@link cp.spawn}
 */
export function spawn(command: Command, options?: RunOptions) {
  const cmd = typeof command === "string" ? command : command[0];
  const args = typeof command === "string" ? [] : command.slice(1);

  const stdin = options?.stdin ?? "inherit";
  const stdout = options?.stdout ?? "inherit";
  const stderr = options?.stderr ?? "inherit";

  return cp.spawn(cmd, args, { ...options, stdio: [stdin, stdout, stderr] });
}

/**
 * Behaves similarly to {@link cp.exec} but allows customizing stdin/stdout/stderr behavior
 * like {@link cp.spawn}
 */
export function run(command: Command, options?: RunOptions) {
  const proc = spawn(command, options);

  const procPromise = new Promise<void>((resolve, reject) => {
    proc.on("error", (err) => reject(new SpawnError(command, options, err)));
    proc.on("exit", () => resolve());
  });
  const promise: Promise<RunResult> = Promise.all([
    procPromise,
    proc.stdout ? consumers.text(proc.stdout) : undefined,
    proc.stderr ? consumers.text(proc.stderr) : undefined,
  ])
    .then(([_, stdout, stderr]) => new RunResult(command, options, proc, stdout, stderr))
    .then((result) => {
      if (options?.check) result.check();
      return result;
    });

  const promiseWithChild = promise as cp.PromiseWithChild<RunResult>;
  promiseWithChild.child = proc;
  return promiseWithChild;
}
