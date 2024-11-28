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
