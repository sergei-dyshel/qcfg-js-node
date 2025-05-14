import {
  MultiBar as CliMultiBar,
  type SingleBar as CliSingleBar,
  type Options,
  Presets,
} from "cli-progress";
import type { WriteStream } from "tty";
import { AsyncContext } from "./async-context";
import { LineBufferedTransform } from "./stream";

export { Presets as BarPresets };

/**
 * See {@link https://www.npmjs.com/package/cli-progress}.
 */
export class MultiBar<T extends object = object> extends CliMultiBar implements Disposable {
  override create<P extends object>(
    total: number,
    startValue: number,
    payload?: P,
    barOptions?: Options,
  ): SingleBar<P>;
  override create(
    total: number,
    startValue: number,
    payload?: T,
    barOptions?: Options,
  ): SingleBar<T>;
  override create(
    total: number,
    startValue: number,
    payload?: object,
    barOptions?: Options,
  ): SingleBar {
    const singleBar = super.create(total, startValue, payload, barOptions) as SingleBar;
    return singleBar;
  }

  [Symbol.dispose]() {
    this.stop();
  }
}

export interface SingleBar<T extends object = object> extends CliSingleBar {
  update(current: number, payload?: T): void;
  update(payload: T): void;
  start(total: number, startValue: number, payload?: T): void;
}

export async function withProgressBar<M extends object, T>(
  bar: MultiBar<M> | undefined,
  callback: () => Promise<T>,
) {
  return bar
    ? AsyncContext.run(await progressBarLog(bar), async () => {
        try {
          return await callback();
        } finally {
          bar.stop();
        }
      })
    : await callback();
}

async function progressBarLog<M extends object>(
  bar: MultiBar<M>,
): Promise<AsyncContext.SimpleModifier> {
  const wrapAnsi = await import("wrap-ansi");
  const logTransform = (stream: WriteStream) => {
    const [numColumns, _] = stream.getWindowSize();
    return new LineBufferedTransform(
      (line) => {
        // see https://github.com/npkgz/cli-progress/issues/142
        const wrappedLine = wrapAnsi.default(line, numColumns, { hard: true, trim: false }) + "\n";
        bar.log(wrappedLine);
        return line;
      },
      {
        forceEndingEOL: true,
      },
    );
  };
  return (context) => [
    {
      stdout:
        context.stdout === process.stdout && process.stdout.isTTY
          ? logTransform(process.stdout)
          : context.stdout,
      stderr:
        context.stderr === process.stderr && process.stderr.isTTY
          ? logTransform(process.stderr)
          : context.stderr,
    },
  ];
}
