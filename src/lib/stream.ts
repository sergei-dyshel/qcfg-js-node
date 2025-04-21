/**
 * @file
 *
 *   Helper utilities for dealing with NodeJS streams.
 */

import { EOL } from "node:os";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AsyncContext } from "./async-context";
import { addMaxListeners } from "./misc";

export async function concatenateStreams(
  readables: Iterable<NodeJS.ReadableStream>,
  writable: NodeJS.WritableStream,
): Promise<void> {
  for (const readable of readables) {
    await pipeline(readable, writable, { signal: AsyncContext.getSignal(), end: false });
  }
}

export function writeStream(stream: NodeJS.WritableStream, buffer: Uint8Array | string) {
  return new Promise<void>((resolve, reject) => {
    stream.write(buffer, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

export function endStream(stream: NodeJS.WritableStream) {
  return new Promise<void>((resolve, _) => {
    stream.end(() => resolve());
  });
}

export type LineTransformFunc = (line: string) => string;

/**
 * {@link Transform} stream that translates each whole line (ending with newline) with given
 * function.
 */
export class LineBufferedTransform extends Transform {
  // For more implementation tips look here:
  // https://github.com/bitfasching/node-line-transform-stream/blob/master/line-transform-stream.js
  // https://www.npmjs.com/package/line-transform-stream
  // https://codingpajamas.github.io/2015/04/26/nodejs-transform-stream
  // https://stackoverflow.com/questions/44664207/transform-stream-to-prepend-string-to-each-line

  /**
   * Latest non-terminated line.
   *
   * Note the difference between `undefined` (no text) and `""` (empty line).
   */
  private buffer = "";

  constructor(
    /**
     * Line transformation function.
     *
     * Accepts line without not ending with newline and should return line not ending with newline.
     */
    private readonly func?: LineTransformFunc,
    private readonly options?: {
      /**
       * Add trailing newline even if last line does not end with one.
       *
       * Useful when using multiple LineBufferedTransforms piping into same stream to make sure last
       * lines are not merged together.
       */
      forceEndingEOL?: boolean;
    },
  ) {
    super();
  }

  private transformLine(line: string) {
    return this.func ? this.func(line) : line;
  }

  override _transform(
    chunk: string | Buffer,
    _: BufferEncoding,
    callback: TransformCallback,
  ): void {
    try {
      const str = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const lines = str.split(EOL);
      lines[0] = this.buffer + lines[0];
      // there will be at least one element returned by split
      // if chunk ends with newline
      this.buffer = lines.pop()!;
      const out =
        lines.length > 0 ? lines.map((line) => this.transformLine(line)).join(EOL) + EOL : "";
      callback(null, out);
    } catch (err) {
      callback(err as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    try {
      const out =
        this.buffer != ""
          ? this.transformLine(this.buffer) + (this.options?.forceEndingEOL ? EOL : "")
          : "";
      callback(null, out);
    } catch (err) {
      callback(err as Error);
    }
  }
}

/**
 * Transform all output to stdout/stderr by given functions with line-buffering.
 */
export function transformStd(options?: {
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
}): AsyncContext.Modifier {
  if (options?.stdout === undefined && options?.stderr === undefined) return AsyncContext.identity;

  return () => {
    // when runng in multiple workers in parallel, each one adds listeners to stdout/stderr
    // adjust max listeners to avoid the warning
    addMaxListeners(AsyncContext.getStdout(), 1);
    addMaxListeners(AsyncContext.getStderr(), 1);

    const stdout = new LineBufferedTransform(options.stdout, { forceEndingEOL: true });
    stdout.pipe(AsyncContext.getStdout(), { end: false });

    const stderr = new LineBufferedTransform(
      options.stderr === null ? options.stdout : options.stderr,
      {
        forceEndingEOL: true,
      },
    );
    stderr.pipe(AsyncContext.getStderr(), { end: false });
    return [
      { stdout, stderr },
      () => {
        stdout.end();
        stderr.end();
      },
    ];
  };
}

/**
 * Prefix stdout/stderr with some string
 */
export function prefixStd(prefix?: string): AsyncContext.Modifier {
  if (prefix === undefined || prefix === "") return AsyncContext.identity;

  return transformStd({
    stdout: (line) => prefix + line,
    stderr: null,
  });
}
