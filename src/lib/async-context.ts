import "@sergei-dyshel/typescript/shims";

import { normalizeArray } from "@sergei-dyshel/typescript/array";
import type { Arrayable, Awaitable } from "@sergei-dyshel/typescript/types";
import { AsyncLocalStorage } from "async_hooks";
import { Writable } from "node:stream";
import type { TimerOptions } from "node:timers";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { anyAbortSignal } from "./abort-signal";

export interface AsyncContext {
  parallel?: boolean;

  stdout?: Writable;
  stderr?: Writable;

  signal?: AbortSignal;
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

  export function getSignal() {
    return get().signal;
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
   * Replacement for promisified version of {@link setTimeoutPromise} that respects current context's
   * {@link AbortSignal}
   */
  export async function setTimeout<T = void>(delay: number, value?: T, options?: TimerOptions) {
    return await setTimeoutPromise(delay, value, {
      ...options,
      signal: anyAbortSignal(getSignal(), options?.signal),
    });
  }

  /**
   * Run function in async context.
   *
   * Similar to {@link AsyncLocalStorage.run} but instead full context object recives series of
   * modifying functions.
   */
  export async function run<R>(modifiers: Modifier | Modifier[] | undefined, callback: () => R) {
    let context: AsyncContext = get();
    await using stack = new AsyncDisposableStack();
    for (const modifier of normalizeArray(modifiers)) {
      const [override, onDispose] = modifier(context);
      if (onDispose) stack.defer(onDispose);
      context = { ...context, ...override };
    }

    // await is needed so that DisposableStack callbacks do not run too early
    // eslint-disable-next-line @typescript-eslint/await-thenable
    return await asyncContext.run(context, callback);
  }

  /**
   * Modify async context for the rest of execution (see {@link AsyncLocalStorage.enterWith})
   *
   * Must be used with caution, prefer {@link AsyncContext.run}.
   */
  export function enterWith(modifiers: Arrayable<SimpleModifier>) {
    let context: AsyncContext = get();
    for (const modifier of normalizeArray(modifiers)) {
      const [override] = modifier(context);
      context = { ...context, ...override };
    }
    asyncContext.enterWith(context);
  }

  /**
   * {@link AsyncContext} modifying function that can optional return a dispose callback.
   *
   * For use with {@link AsyncContext.run}
   */
  export type Modifier = (
    _: AsyncContext,
  ) => [override: AsyncContext, onDispose?: () => Awaitable<void>];

  /**
   * {@link AsyncContext} modifying function without dispose callback.
   *
   * For use with {@link AsyncContext.run} or {@link AsyncContext.enterWith}
   */
  export type SimpleModifier = (_: AsyncContext) => [override: AsyncContext];

  /**
   * Identity modifier - passes same context without modifications
   */
  export const identity: SimpleModifier = (ctx: AsyncContext) => [ctx];

  /**
   * Add {@link AbortSignal} to context (merges with existing signals).
   */
  export function addSignal(signal?: AbortSignal): SimpleModifier {
    return (context) => [{ signal: anyAbortSignal(context.signal, signal) }];
  }
}
