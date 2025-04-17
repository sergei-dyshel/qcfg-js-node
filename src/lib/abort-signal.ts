import { filterNonNull } from "@sergei-dyshel/typescript/array";
import { isErrnoException } from "./error";

/**
 * More convenient version of {@link AbortSignal.any} which also ignores undefined arguments
 */
export function anyAbortSignal(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const realSignals = filterNonNull(signals);
  if (realSignals.length === 0) return undefined;
  return AbortSignal.any(realSignals);
}

/**
 * Whether error was caused by {@link AbortSignal.abort}
 *
 * Abort reason is stored in {@link Error.cause}
 */
export function isAbortError(err: unknown): err is NodeJS.ErrnoException {
  return isErrnoException(err) && err.name === "AbortError" && err.code === "ABORT_ERR";
}
