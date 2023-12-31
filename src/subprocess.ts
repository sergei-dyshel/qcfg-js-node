import * as cp from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as consumers from "node:stream/consumers";

export enum Stdio {
  PIPE = "pipe",
  IGNORE = "ignore",
}

export interface RunOptions extends cp.SpawnOptionsWithoutStdio {
  stdin?: Stdio | Readable;
  stdout?: Stdio | Writable;
  stderr?: Stdio | Writable;
}

export class RunResult {
  constructor(
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
}

export function spawn(command: string | string[], options?: RunOptions): cp.ChildProcess {
  const cmd = typeof command === "string" ? command : command[0];
  const args = typeof command === "string" ? [] : command.slice(1);

  const stdin = options?.stdin ?? "inherit";
  const stdout = options?.stdout ?? "inherit";
  const stderr = options?.stderr ?? "inherit";

  return cp.spawn(cmd, args, { ...options, stdio: [stdin, stdout, stderr] });
}

export function run(
  command: string | string[],
  options?: RunOptions,
): cp.PromiseWithChild<RunResult> {
  const proc = spawn(command, options);

  const procPromise = new Promise<void>((resolve, reject) => {
    proc.on("error", (err) => reject(err));
    proc.on("exit", () => resolve());
  });
  const promise: Promise<RunResult> = Promise.all([
    procPromise,
    proc.stdout ? consumers.text(proc.stdout) : undefined,
    proc.stderr ? consumers.text(proc.stderr) : undefined,
  ]).then(([_, stdout, stderr]) => new RunResult(proc, stdout, stderr));

  const promiseWithChild = promise as cp.PromiseWithChild<RunResult>;
  promiseWithChild.child = proc;
  return promiseWithChild;
}
