import { assert } from "@sergei-dyshel/typescript/error";
import { join } from "node:path";
import * as lockfile from "proper-lockfile";
import type { Logger } from "../logging";

/** Inter-process reentrant lock */
export class GlobalLock {
  private release?: () => Promise<void>;
  private refCount = 0;
  private locking?: ReturnType<typeof lockfile.lock>;
  private releasing?: Promise<void>;

  constructor(private logger?: Logger) {}

  /**
   * Run function while locked.
   *
   * Must use same @param directory on each invocation.
   */
  async with<T>(directory: string, f: () => Promise<T>): Promise<T> {
    if (this.refCount === 0) {
      await this.releasing;
      if (!this.locking) {
        this.logger?.trace("Globally locking " + directory);
        this.locking = lockfile.lock(directory, {
          lockfilePath: join(directory, ".lock"),
          retries: 3,
        });
      }
      this.release = await this.locking;
      this.locking = undefined;
    }
    this.refCount += 1;
    try {
      return await f();
    } finally {
      this.refCount -= 1;
      assert(this.refCount >= 0);
      if (this.refCount === 0) {
        if (!this.releasing) {
          this.logger?.trace("Releasing global lock on " + directory);
          this.releasing = this.release!();
          this.release = undefined;
        }
        await this.releasing;
        this.releasing = undefined;
      }
    }
  }
}
