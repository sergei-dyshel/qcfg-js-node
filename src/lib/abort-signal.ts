import { filterNonNull } from "@sergei-dyshel/typescript/array";
import { setMaxListeners } from "node:events";
import { isErrnoException } from "./error";

/**
 * More convenient version of {@link AbortSignal.any} which also ignores undefined arguments
 */
export function anyAbortSignal(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const realSignals = filterNonNull(signals);
  if (realSignals.length === 0) return undefined;
  const signal = AbortSignal.any(realSignals);
  removeAbortSignalListenersLimit(signal);
  return signal;
}

/**
 * Whether error was caused by {@link AbortSignal.abort}
 *
 * Abort reason is stored in {@link Error.cause}
 */
export function isAbortError(err: unknown): err is NodeJS.ErrnoException {
  return isErrnoException(err) && err.name === "AbortError" && err.code === "ABORT_ERR";
}

/**
 * Remove limit on listeners for signal.
 *
 * AbortSignal may propagates everywhere so there may be many abort listeners won't be needed in
 * node v24, see https://github.com/nodejs/node/pull/55816
 */
export function removeAbortSignalListenersLimit(signal: AbortSignal) {
  setMaxListeners(Infinity, signal);
}
