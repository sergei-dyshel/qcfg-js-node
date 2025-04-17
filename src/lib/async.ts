import { fail } from "@sergei-dyshel/typescript/error";
import { clearTimeout, setTimeout } from "timers";
import { AsyncContext } from "./async-context";

export async function waitForever() {
  async function internal() {
    await AsyncContext.setTimeout(10 * 1000); // 10 seconds
    await internal();
  }
  await internal();
  fail("Should never get here");
}

export class AsyncRequestCoalescer<T, R> {
  private queue: Entry<T, R>[] = [];
  private timeout?: NodeJS.Timeout;

  constructor(
    private periodMs: number,
    private coalese: (_: T[]) => Promise<R[]>,
  ) {}

  async request(value: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      this.queue.push({ value, resolve, reject });
      if (this.timeout) clearTimeout(this.timeout);
      this.timeout = setTimeout(() => {
        void this.onTimeout();
      }, this.periodMs);
    });
  }

  private async onTimeout() {
    const entries = this.queue.splice(0 /* start */);
    const values = entries.map((entry) => entry.value);
    try {
      const results = await this.coalese(values);
      entries.forEach((entry, i) => entry.resolve(results[i]));
    } catch (err) {
      entries.forEach((entry) => entry.reject(err));
    }
  }
}

interface Entry<T, R> {
  value: T;
  resolve: (value: R | PromiseLike<R>) => void;
  reject: (reason?: any) => void;
}
