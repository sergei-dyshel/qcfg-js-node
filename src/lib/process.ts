import { errorCausedBy } from "@sergei-dyshel/typescript/error";
import { type Awaitable, type ElementType, extendsType } from "@sergei-dyshel/typescript/types";
import { isAbortError } from "./abort-signal";
import { AsyncContext } from "./async-context";

const SIGNALS = extendsType<NodeJS.Signals[]>()(["SIGTERM", "SIGINT"]);

type SignalsType = ElementType<typeof SIGNALS>;

export namespace OnTerminate {
  const controller = new AbortController();
  let installed = false;

  export function signal() {
    return controller.signal;
  }

  function handler(signal: string) {
    process.stderr.write(`Caught ${signal}\n`);
    // remove handlers so that second press of Ctrl-C will cancellation flow (which may be stuck/long too)
    for (const signal of SIGNALS) process.removeAllListeners(signal);
    controller.abort(signal);
  }

  /**
   * Install signal handlers and add {@link AbortSignal} to async context
   */
  export function install() {
    if (installed) return;
    for (const signal of SIGNALS) process.on(signal, handler);
    AsyncContext.enterWith(AsyncContext.addSignal(signal()));
    installed = true;
  }

  /**
   * Whether error was caused by {@link AbortSignal}
   */
  export function causedBySignal(err: unknown) {
    return errorCausedBy(err, (err) =>
      isAbortError(err) &&
      typeof err.cause === "string" &&
      SIGNALS.includes(err.cause as SignalsType)
        ? (err.cause as SignalsType)
        : undefined,
    );
  }

  /**
   * Terminate process if error was caused by observed signals
   */
  export function killIfCausedBy(err: unknown) {
    const signal = causedBySignal(err);
    // Should work because we remove listeners upon receiving signal
    if (signal) {
      process.stderr.write(`Exiting on ${signal}\n`);
      process.kill(process.pid, signal);
      return true;
    }
    // XXX: not sure return value is needed
    return false;
  }
}

/**
 * Run function when chdir-ed into given directory.
 *
 * Guarantees that after running the function `cwd` won't be changed.
 */
export async function withChdir(dir: string, fn: () => Awaitable<void>) {
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    await fn();
  } finally {
    process.chdir(cwd);
  }
}
