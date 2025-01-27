import type { Awaitable } from "@sergei-dyshel/typescript/types";
import { setTimeout as setTimeoutPromise } from "timers/promises";

export namespace OnTerminate {
  export class Error extends global.Error {
    constructor(signal: string) {
      super(`Received ${signal}, exiting...`);
    }
  }

  const controller = new AbortController();
  let installed = false;

  export function signal() {
    return controller.signal;
  }

  function handler(signal: string) {
    controller.abort(signal);
  }

  export function install() {
    if (installed) return;
    process.on("SIGTERM", handler);
    process.on("SIGINT", handler);
    installed = true;
  }

  export function check() {
    if (controller.signal.aborted) {
      throw new Error(controller.signal.reason as string);
    }
  }

  export async function setTimeout<T = void>(delay: number, value?: T) {
    check();
    try {
      return await setTimeoutPromise(delay, value, { signal: signal() });
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") check();
      throw err;
    }
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
