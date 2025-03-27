/**
 * @file Wrapper over {@link child_process} with interface similar to Python's subprocess.
 *
 *   Provides functions {@link run} and {@link spawn} with similiar interface to child_process's
 *   counterparts.
 *
 *   Important differences though:
 *
 *   - Automatically runs in shell if `command` is a string.
 *   - `stdin/stdout/stderr` are `inherit` by default (like in Python's `subuprocess` and unlike Node's
 *       default `pipe`)
 *   - `stdout/stderr` can be any stream, not just file/socket (piped internally)
 */

import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { assert } from "@sergei-dyshel/typescript/error";
import type { WithRequired } from "@sergei-dyshel/typescript/types";
import type {
  ChildProcess,
  IOType,
  PromiseWithChild,
  SpawnOptionsWithoutStdio,
  SpawnSyncOptions,
  exec,
} from "node:child_process";
import * as child_process from "node:child_process";
import { ReadStream, WriteStream } from "node:fs";
import { Socket } from "node:net";
import { PassThrough, Stream, type Readable, type Writable } from "node:stream";
import * as consumers from "node:stream/consumers";
import { AsyncContext } from "./async-context";
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

/** Subset of {@link IOType} */
type StdioType = "pipe" | "ignore";

export interface SubprocessRunOptions {
  /** Similar to {@link SpawnSyncOptions.input}, pass this text to stdin. */
  input?: string;
  stdin?: StdioType | Readable;
  stdout?: StdioType | Writable;
  stderr?:
    | StdioType
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

type StdioStream = WriteStream | ReadStream | Socket;

/**
 * Check if stream can be passed to {@link child_process.spawn} `stdio` argument.
 *
 * According to {@link https://nodejs.org/api/child_process.html#optionsstdio}: "Share a readable or
 * writable stream that refers to a tty, file, socket, or a pipe with the child process. The
 * stream's underlying file descriptor is duplicated in the child process to the fd that corresponds
 * to the index in the stdio array. The stream must have an underlying descriptor."
 */
function isValidStdioStream(stream: Stream): stream is StdioStream {
  return stream instanceof WriteStream || stream instanceof ReadStream || stream instanceof Socket;
}

/**
 * Convert `stdin/stdout/stderr` options in {@link RunOptions} to descriptors suitable for passing to
 * {@link child_process.spawn}.
 */
function buildStdio({ input, stdin, stdout, stderr }: RunOptions) {
  const spawnIn: IOType | StdioStream = input
    ? "pipe"
    : stdin === undefined
      ? "inherit"
      : stdin == "pipe" || stdin == "ignore"
        ? stdin
        : isValidStdioStream(stdin)
          ? stdin
          : "pipe";

  if (input) assert(stdin === undefined, "Can not pass both 'stdin' and 'input' properties");

  const asyncCtx = AsyncContext.get();
  stdout = stdout ?? asyncCtx.stdout;
  stderr = stderr ?? asyncCtx.stderr;

  const spawnOut: IOType | StdioStream =
    stdout === undefined
      ? "inherit"
      : stdout === "pipe" || stdout === "ignore"
        ? stdout
        : isValidStdioStream(stdout)
          ? stdout
          : "pipe";

  const spawnErr: IOType | StdioStream =
    stderr === undefined
      ? "inherit"
      : stderr === "pipe" || stderr === "ignore"
        ? stderr
        : stderr === "stdout"
          ? spawnOut
          : isValidStdioStream(stderr)
            ? stderr
            : "pipe";

  return [spawnIn, spawnOut, spawnErr] as const;
}

/** Similar to {@link child_process.spawn} */
export function spawn(command: Command, options?: RunOptions) {
  const signal = options?.signal;
  if (options?.check && options.throwIfAborted) signal?.throwIfAborted();

  const cmd = typeof command === "string" ? command : command[0];
  const args = typeof command === "string" ? [] : command.slice(1);

  logRun(command, options?.log);

  // append given env to that of the process
  if (options?.env) options = { ...options, env: { ...process.env, ...options.env } };
  const stdio = buildStdio(options ?? {});
  const proc = child_process.spawn(cmd, args, {
    ...options,
    stdio: [...stdio], // convert readonly array to mutable
  });

  const [spawnIn, spawnOut, spawnErr] = stdio;

  if (options?.input) {
    assert(spawnIn === "pipe");
    proc.stdin!.end(options.input);
  } else if (
    options?.stdin &&
    options.stdin !== "pipe" &&
    options.stdin !== "ignore" &&
    !isValidStdioStream(options.stdin)
  ) {
    assert(spawnIn === "pipe");
    options.stdin.pipe(proc.stdin!);
  }

  const asyncCtx = AsyncContext.get();
  const stdout = options?.stdout ?? asyncCtx.stdout;
  const stderr = options?.stderr ?? asyncCtx.stderr;

  if (stderr === "stdout" && stdout === "pipe") {
    assert(spawnOut === "pipe" && spawnErr === "pipe");
    const output = new PassThrough({ emitClose: true });
    const procOut = proc.stdout!;
    const procErr = proc.stderr!;
    procOut.pipe(output, { end: false });
    procErr.pipe(output, { end: false });

    // close merged output only when both stdout/stderr pipes are closed
    procOut.on("close", () => {
      if (procErr.closed) output.end();
    });
    procErr.on("close", () => {
      if (procOut.closed) output.end();
    });

    // we use those later in `run` to extract all output
    proc.stdout = output;
    proc.stderr = null;
  }

  if (spawnOut === "pipe" && stdout instanceof Stream) {
    proc.stdout!.pipe(stdout, { end: false });
    proc.stdout = null;
  }

  if (spawnErr === "pipe") {
    if (stderr === "stdout" && stdout instanceof Stream) {
      proc.stderr!.pipe(stdout, { end: false });
      proc.stderr = null;
    } else if (stderr instanceof Stream) {
      proc.stderr!.pipe(stderr, { end: false });
      proc.stderr = null;
    }
  }

  return proc;
}

/**
 * Behaves similarly to {@link exec} but allows customizing stdin/stdout/stderr behavior like
 * {@link child_process.spawn}
 */
export function run(command: Command, options?: RunOptions) {
  const proc = spawn(command, options);

  const procPromise = new Promise<void>((resolve, reject) => {
    proc.on("error", (err) => {
      reject(new SpawnError(command, options, err));
    });
    proc.on("exit", () => {
      resolve();
    });
  });

  const promise: Promise<RunResult> = Promise.all([
    procPromise,
    proc.stdout ? consumers.buffer(proc.stdout) : undefined,
    proc.stderr ? consumers.buffer(proc.stderr) : undefined,
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
