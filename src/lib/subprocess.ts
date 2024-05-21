import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { PlainObject, WithRequired } from "@sergei-dyshel/typescript/types";
import * as cp from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as consumers from "node:stream/consumers";
import { shlex } from "./shlex";

/** @file Wrapper over Node's `child_process` that more resembles Python's subprocess module. */

export type Command = string | string[];

export enum Stdio {
  PIPE = "pipe",
  IGNORE = "ignore",
}

export interface SubprocessRunOptions {
  stdin?: Stdio | Readable;
  stdout?: Stdio | Writable;
  stderr?: Stdio | Writable;

  check?: boolean;
}

export type RunOptions = cp.SpawnOptionsWithoutStdio & SubprocessRunOptions;

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
    public readonly stdout?: string,
    public readonly stderr?: string,
  ) {}

  get exitCode() {
    return this.process.exitCode;
  }

  get signalCode() {
    return this.process.signalCode;
  }

  checkError() {
    return new RunError(this);
  }

  check() {
    if (this.signalCode || this.exitCode != 0) throw this.checkError();
  }
}

export type RunResultWithOut = WithRequired<RunResult, "stdout">;
export type RunResultWithOutErr = WithRequired<RunResult, "stdout" | "stderr">;

export function shlexJoin(command: Command) {
  return typeof command === "string" ? command : shlex.join(command);
}

export class RunError extends Error {
  constructor(public readonly result: RunResult) {
    const cmd = shlexJoin(result.command);
    const reason = result.signalCode
      ? `was killed by signal ${result.signalCode}`
      : `exited with code ${result.exitCode}`;
    super(`Command '${cmd}' ${reason}`);
    this.name = "CheckError";
  }
}

/** Wraps over {@link cp.spawn} */
export function spawn(command: Command, options?: RunOptions) {
  const cmd = typeof command === "string" ? command : command[0];
  const args = typeof command === "string" ? [] : command.slice(1);

  const stdin = options?.stdin ?? "inherit";
  const stdout = options?.stdout ?? "inherit";
  const stderr = options?.stderr ?? "inherit";

  return cp.spawn(cmd, args, { ...options, stdio: [stdin, stdout, stderr] });
}

/**
 * Behaves similarly to {@link cp.exec} but allows customizing stdin/stdout/stderr behavior like
 * {@link cp.spawn}
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
    .then(([_, stdout, stderr]) => {
      return new RunResult(command, options, proc, stdout, stderr);
    })
    .then((result) => {
      if (options?.check) result.check();
      return result;
    });

  const promiseWithChild = promise as cp.PromiseWithChild<RunResult>;
  promiseWithChild.child = proc;
  return promiseWithChild;
}

export function mergeRunOptions(...options: Array<RunOptions | undefined>): RunOptions {
  return deepMerge(...options.map((o) => <PlainObject>o));
}
