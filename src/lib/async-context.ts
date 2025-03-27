import { AsyncLocalStorage } from "async_hooks";
import { Writable } from "stream";
import { LineBufferedTransform, type LineTransformFunc } from "./stream";

export interface AsyncContext {
  parallel?: boolean;

  stdout?: Writable;
  stderr?: Writable;
}

const asyncContext = new AsyncLocalStorage<AsyncContext>();

/**
 * Pass-through to stream obtain during runtime with getter
 */
class WritableProxy extends Writable {
  constructor(private readonly getter: () => Writable) {
    super();
  }
  override _write(
    chunk: any,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    // Uncomment for debugging:
    // const str =
    //   typeof chunk === "string"
    //     ? chunk
    //     : (chunk as Buffer).toString((encoding as string) === "buffer" ? "utf8" : encoding);
    this.getter()._write(chunk, encoding, callback);
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.getter()._final(callback);
  }
}

export namespace AsyncContext {
  export function get(): AsyncContext {
    return asyncContext.getStore() ?? {};
  }

  export function getStdout(): Writable {
    return get().stdout ?? process.stdout;
  }

  export function getStderr(): Writable {
    return get().stderr ?? process.stderr;
  }

  /**
   * Dynamically translates to {@link AsyncContext.stdout} if defined or to `process.stdout`}
   */
  export const stdout = new WritableProxy(() => get().stdout ?? process.stdout);

  /**
   * Dynamically translates to {@link AsyncContext.stderr} if defined or to `process.stderr`}
   */
  export const stderr = new WritableProxy(() => get().stderr ?? process.stderr);

  /**
   * Run function in async context.
   *
   * Similar to {@link AsyncLocalStorage.run} but inherits all unspecified context properties from
   * current context.
   */
  export function run<R>(context: AsyncContext, callback: () => R): R {
    return asyncContext.run({ ...get(), ...context }, callback);
  }

  /**
   * Run function in async context and transform all output to stdout/stderr with given functions
   * with line-buffering.
   */
  export async function transformStd<R>(
    callback: () => Promise<R>,
    options?: {
      /**
       * Line transformation function for stdout.
       */
      stdout?: LineTransformFunc;
      /**
       * Line transformation function for stderr.
       *
       * When `null`, use same function as for stdout.
       */
      stderr?: LineTransformFunc | null;
    },
  ) {
    const stdout = new LineBufferedTransform(options?.stdout, { forceEndingEOL: true });
    stdout.pipe(getStdout(), { end: false });

    const stderr = new LineBufferedTransform(
      options?.stderr === null ? options.stdout : options?.stderr,
      {
        forceEndingEOL: true,
      },
    );
    stderr.pipe(getStderr(), { end: false });

    try {
      return await run({ stdout, stderr }, callback);
    } finally {
      stdout.end();
      stderr.end();
    }
  }

  export async function prefixStd<R>(prefix: string, callback: () => Promise<R>) {
    return transformStd(callback, {
      stdout: (line) => prefix + line,
      stderr: null,
    });
  }
}
