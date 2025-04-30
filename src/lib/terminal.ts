import {
  MultiBar as CliMultiBar,
  type SingleBar as CliSingleBar,
  type Options,
  Presets,
} from "cli-progress";
import { AsyncContext } from "./async-context";
import { LineBufferedTransform } from "./stream";

export { Presets as BarPresets };

/**
 * See {@link https://www.npmjs.com/package/cli-progress}.
 */
export class MultiBar<T extends object> extends CliMultiBar implements Disposable {
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
    ? AsyncContext.run(progressBarLog(bar), async () => {
        try {
          return await callback();
        } finally {
          bar.stop();
        }
      })
    : await callback();
}

function progressBarLog<M extends object>(bar: MultiBar<M>): AsyncContext.SimpleModifier {
  const logTransform = new LineBufferedTransform(
    (line) => {
      bar.log(line + "\n");
      return line;
    },
    {
      forceEndingEOL: true,
    },
  );
  return (context) => [
    {
      stdout:
        context.stdout === process.stdout && process.stdout.isTTY ? logTransform : context.stdout,
      stderr:
        context.stderr === process.stderr && process.stderr.isTTY ? logTransform : context.stderr,
    },
  ];
}
