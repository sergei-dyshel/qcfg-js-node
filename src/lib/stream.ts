/**
 * @file
 *
 *   Helper utilities for dealing with NodeJS streams.
 */

import { assert } from "@sergei-dyshel/typescript/error";
import { EOL } from "node:os";
import { Transform, type TransformCallback } from "node:stream";

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

export class LineBufferedTransform extends Transform {
  // Look here:
  // https://github.com/bitfasching/node-line-transform-stream/blob/master/line-transform-stream.js
  // https://www.npmjs.com/package/line-transform-stream
  // https://codingpajamas.github.io/2015/04/26/nodejs-transform-stream
  // https://stackoverflow.com/questions/44664207/transform-stream-to-prepend-string-to-each-line

  private buffer = "";

  constructor(
    private readonly opts?: {
      encoding?: BufferEncoding;
    },
  ) {
    super(opts);
  }

  override _transform(
    chunk: string | Buffer,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    assert(encoding === this.opts?.encoding);
    const str = chunk.toString(this.opts.encoding);
    const lines = str.split(EOL);
    lines[0] = this.buffer + lines[0];
    // there will be at least one element returned by split
    this.buffer = lines.pop()!;
    callback();
  }
}
