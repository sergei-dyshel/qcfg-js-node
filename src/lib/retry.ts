import type { Awaitable } from "@sergei-dyshel/typescript/types";
import { AsyncContext } from "./async-context";

const DEFAULT_DELAY_MS = 1000;

/**
 * Generic multi-purpose retry algorithm with exponential backoff
 *
 * Inspired by https://github.com/sindresorhus/p-retry and https://github.com/tim-kos/node-retry.
 */
export async function retry<R>(
  func: () => Awaitable<R>,
  options?: {
    /** Starting delay between retries, in milliseconds, by default 1 second. */
    delayMs?: number;
    /** Factor to multiply delay between attempts, by default 1 */
    backoffFactor?: number;
    /** Maximum delay between retries, in milliseconds, by default unbound */
    maxDelayMs?: number;
    /**
     * Function to call on error.
     *
     * If function returns - retry, otherwise function must throw exception to stop retries.
     */
    onError?: (err: unknown) => Awaitable<void>;
  },
) {
  for (;;) {
    let delayMs = options?.delayMs ?? DEFAULT_DELAY_MS;
    try {
      return await func();
    } catch (err) {
      await options?.onError?.(err);
      await AsyncContext.setTimeout(delayMs);
      delayMs = Math.min(
        (delayMs * (options?.backoffFactor ?? 1), options?.maxDelayMs ?? Infinity),
      );
    }
  }
}
