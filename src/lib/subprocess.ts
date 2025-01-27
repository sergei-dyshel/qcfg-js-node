import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { assertNotNull, fail } from "@sergei-dyshel/typescript/error";
import type { WithRequired } from "@sergei-dyshel/typescript/types";
import {
  spawn as childProcessSpawn,
  type ChildProcess,
  type IOType,
  type PromiseWithChild,
  type SpawnOptionsWithoutStdio,
  type SpawnSyncOptions,
  type StdioOptions,
  type exec,
} from "node:child_process";
import { PassThrough, Stream, type Writable } from "node:stream";
import * as consumers from "node:stream/consumers";
import { LogLevel, RootLogger, type Logger } from "./logging";
import { shlex } from "./shlex";

/** @file Wrapper over Node's `child_process` that more resembles Python's subprocess module. */

const DEFAULT_LOG_PREFIX = "+ ";
const DEFAULT_LOG_LEVEL = LogLevel.DEBUG;

export interface RunLogOptions {
  /** Logging occurs only if this flag is set */
  shouldLog?: boolean;

  /** Logger to use, if not defined logging won't happen */
  logger?: Logger;

  /** Log level, by default {@link DEFAULT_LOG_LEVEL} */
  logLevel?: LogLevel;

  /** Prefix to prepend to logged command line, by default {@link DEFAULT_LOG_PREFIX} */
  prefix?: string;
}

export type Command = string | string[];

export interface SubprocessRunOptions {
  /** Similar to {@link SpawnSyncOptions.input}, pass this text to stdin. */
  input?: string | Stream;
  stdin?: IOType | Stream;
  stdout?: IOType | Writable;
  stderr?:
    | IOType
    | Writable
    /** Redirect stderr to stdout */
    | "stdout";

  allowedExitCodes?: number[];
  /** Raise error if process exits with non-allowed exit code */
  check?: boolean;
  throwIfAborted?: boolean;
}

export type RunOptions = SpawnOptionsWithoutStdio & SubprocessRunOptions & { log?: RunLogOptions };

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
    public readonly process: ChildProcess,
    public readonly stdoutBuffer?: Buffer,
    public readonly stderrBuffer?: Buffer,
  ) {}

  get stdout() {
    return this.stdoutBuffer?.toString();
  }

  get stderr() {
    return this.stderrBuffer?.toString();
  }

  get exitCode() {
    return this.process.exitCode;
  }

  get signalCode() {
    return this.process.signalCode;
  }

  /** Process was killed because {@link RunOptions.signal} was raised. */
  get isAborted() {
    return this.options?.signal?.aborted ?? false;
  }

  checkError() {
    return new RunError(this);
  }

  check() {
    if (
      this.signalCode != null ||
      (this.exitCode !== null && !(this.options?.allowedExitCodes ?? [0]).includes(this.exitCode))
    ) {
      this.options?.signal?.throwIfAborted();
      throw this.checkError();
    }
  }
}

export type RunResultWithOut = WithRequired<RunResult, "stdout">;
export type RunResultWithOutErr = WithRequired<RunResult, "stdout" | "stderr">;

export function joinCommand(command: Command) {
  return typeof command === "string" ? command : shlex.join(command);
}

export class RunError extends Error {
  constructor(public readonly result: RunResult) {
    const cmd = joinCommand(result.command);
    const reason = result.signalCode
      ? `was killed by signal ${result.signalCode}`
      : `exited with code ${result.exitCode}`;
    super(`Command '${cmd}' ${reason}`);
    this.name = "CheckError";
  }
}

function buildStdio(options?: RunOptions) {
  const stdin = options?.input ? "pipe" : options?.stdin ?? "inherit";

  const stdout = options?.stdout ?? "inherit";

  if (options?.stderr === "stdout") {
    if (stdout == "inherit") return [stdin, process.stdout, process.stdout] as const;
    if (stdout == "pipe") {
      return [stdin, "pipe", "pipe"] as const;
    }
    fail(`stdout == ${String(stdout)}, stderr == ${options.stderr} are not supposrted`);
  }
  const stderr = options?.stderr ?? "inherit";

  return [stdin, stdout, stderr];
}

/** Wraps over {@link childProcessSpawn} */
export function spawn(command: Command, options?: RunOptions) {
  const cmd = typeof command === "string" ? command : command[0];
  const args = typeof command === "string" ? [] : command.slice(1);

  logRun(command, options?.log);
  return childProcessSpawn(cmd, args, {
    ...options,
    stdio: buildStdio(options) as StdioOptions,
  });
}

/**
 * Behaves similarly to {@link exec} but allows customizing stdin/stdout/stderr behavior like
 * {@link childProcessSpawn}
 */
export function run(command: Command, options?: RunOptions) {
  const signal = options?.signal;
  if (options?.check && options.throwIfAborted) signal?.throwIfAborted();
  const proc = spawn(command, options);
  if (options?.input) {
    assertNotNull(proc.stdin);
    if (options.input instanceof Stream) options.input.pipe(proc.stdin);
    if (typeof options.input === "string") proc.stdin.end(options.input);
  }

  const procPromise = new Promise<void>((resolve, reject) => {
    proc.on("error", (err) => {
      reject(new SpawnError(command, options, err));
    });
    proc.on("exit", () => {
      resolve();
    });
  });

  const [stdout, stderr] = (() => {
    if (options?.stderr === "stdout" && options.stdout === "pipe") {
      const output = new PassThrough();
      proc.stdout!.pipe(output);
      proc.stderr!.pipe(output);
      return [output, undefined];
    }
    return [proc.stdout, proc.stderr];
  })();
  const promise: Promise<RunResult> = Promise.all([
    procPromise,
    stdout ? consumers.buffer(stdout) : undefined,
    stderr ? consumers.buffer(stderr) : undefined,
  ])
    .then(([_, stdout, stderr]) => new RunResult(command, options, proc, stdout, stderr))
    .then((result) => {
      if (options?.check) result.check();
      return result;
    });

  const promiseWithChild = promise as PromiseWithChild<RunResult>;
  promiseWithChild.child = proc;
  return promiseWithChild;
}

export function logRun(command: Command, options?: RunLogOptions) {
  const logger = options?.logger ?? RootLogger.get();
  if (!options?.shouldLog) return;
  const prefix = options.prefix ?? DEFAULT_LOG_PREFIX;
  const logLevel = options.logLevel ?? DEFAULT_LOG_LEVEL;
  logger.log(logLevel, prefix + joinCommand(command));
}

/**
 * Abstracts running a command.
 *
 * Used by APIs like Git to allow running commands over SSH etc.
 */
export type Runner<Options = RunOptions> = (
  command: Command,
  options?: Options,
) => Promise<RunResult>;

/**
 * Wraps {@link run} by adding default overridable run option.
 */
export function runner(options: RunOptions): Runner {
  return async (command, opts) => run(command, deepMerge(options, opts));
}
