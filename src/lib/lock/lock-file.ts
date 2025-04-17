import { LoggableError } from "@sergei-dyshel/typescript/error";
import { randomInt } from "node:crypto";
import { constants, type FileHandle, open, readFile, rename, unlink } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { isErrnoException } from "../error";

const MIN_BACKOFF_MS = 1;
const MAX_BACKOFF_MS = 1000;

/**
 * If another process couldn't finalize locking within this timeout, consider it stuck or killed and
 * reclaim the lock.
 *
 * This timeout must be big enough to accomodate for just stalls in Nodejs process event loop
 */
const IN_PROGRESS_TIMEOUT_MS = 300;

export class LockFile implements AsyncDisposable {
  protected locked = false;

  constructor(public readonly path: string) {}

  isLocked() {
    return this.locked;
  }

  /** Lock and return disposable handle for unlocking */
  async lock(options?: LockFile.LockOptions): Promise<LockFile.Handle> {
    const start = Date.now();
    try {
      await LockFile.lockInternal(this.path, start, options);
    } catch (err) {
      if (err instanceof LockFile.Error && err.path === this.path) throw err;
      throw new LockFile.Error(this.path, `Failed to lock file`, { cause: err });
    }
    this.locked = true;
    return new LockFile.Handle(this);
  }

  async unlock(options?: LockFile.UnlockOptions) {
    if (!this.locked) {
      if (options?.idempotent) return;
      throw new LockFile.Error(this.path, `File not locked`);
    }

    // failure of unlockInternal means either verification failed or file not present
    // so we can set unlocked in anycase
    this.locked = false;
    try {
      await LockFile.unlockInternal(this.path, options);
    } catch (err) {
      if (err instanceof LockFile.Error) throw err;
      throw new LockFile.Error(this.path, `Failed to unlock file`, { cause: err });
    }
  }

  /**
   * Try locking given path (can be original path or takeover)
   *
   * Return status which determines next step.
   *
   * Important invariant: function either returns success and lock file was created, or file is not
   * created.
   */
  protected static async tryLock(path: string): Promise<TryLockStatus> {
    let file: FileHandle;

    try {
      file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    } catch (err) {
      if (!isErrnoException(err) || err.code !== "EEXIST") {
        throw err;
      }

      // lock file already exists, probably locked by another process

      const pid = await LockFile.getOwnerPid(path);
      if (pid === undefined) {
        // another process only wrote partial file
        return TryLockStatus.ANOTHER_IN_PROGRESS;
      }
      if (pid === process.pid) {
        // previous lock attempt by current process was aborted but locking succeeded
        return TryLockStatus.LOCK_SUCCESS;
      }
      try {
        process.kill(pid, 0 /* signal */);
      } catch (err) {
        if (isErrnoException(err) && err.code === "ESRCH") {
          // lock owner process is not alive
          return TryLockStatus.TAKEOVER_NEEDED;
        }
        throw err;
      }
      // lock owner process is still alive
      return TryLockStatus.LOCKED_ELSEWHERE;
    }

    try {
      await file.write(String(process.pid) + "\n");
      await file.close();
    } catch (err) {
      await unlink(path);
      throw new LockFile.Error(path, `Failed to write PID to lock file`, { cause: err });
    }
    return TryLockStatus.LOCK_SUCCESS;
  }

  /**
   * Non-trivial details:
   */
  protected static async lockInternal(path: string, start: number, options?: LockFile.LockOptions) {
    const takeoverPath = path + ".takeover";
    let takeoverLocked = false;
    let backoffMs = MIN_BACKOFF_MS;

    /**
     * Start of latest period during which we continuously get ANOTHER_IN_PROGRESS cleared when we
     * finally manage to read PID from file
     */
    let inProgressStart: number | undefined;
    try {
      for (;;) {
        const status = await LockFile.tryLock(path);
        switch (status) {
          case TryLockStatus.LOCK_SUCCESS:
            return; // locked
          case TryLockStatus.LOCKED_ELSEWHERE:
            inProgressStart = undefined;
            break;
          // @ts-expect-error - fallthrough case in switch
          case TryLockStatus.ANOTHER_IN_PROGRESS: {
            backoffMs = MIN_BACKOFF_MS;
            if (inProgressStart === undefined) {
              inProgressStart = Date.now();
              break;
            }
            const elapsed = Date.now() - inProgressStart;
            if (elapsed < IN_PROGRESS_TIMEOUT_MS) break;
            /* FALLTHROUGH */
          }
          case TryLockStatus.TAKEOVER_NEEDED: {
            // XXX: probably should have reset inProgressStart
            if (takeoverLocked) {
              await rename(takeoverPath, path);
              takeoverLocked = false;
              return; // locked
            }
            await LockFile.lockInternal(takeoverPath, start, options);
            takeoverLocked = true;
            // why not immeidately rename and return lock succeeded?
            // because there may be race with another process which also starts takeover a moment
            // after and then renames just like we did
            // but if we see that takeover is still needed (or in-progress timeout) after takeover
            // file is locked then this race is not possible
            backoffMs = MIN_BACKOFF_MS;
            break;
          }
        }
        const elapsedMs = Date.now() - start;
        if (options?.timeoutMs && elapsedMs > options.timeoutMs)
          throw new LockFile.Timeout(
            path,
            `Timeout of ${options.timeoutMs}ms while waiting for lock`,
          );
        await setTimeout(backoffMs);
        // must add jitter otherwise equal backoff will may lead to race and timeout
        backoffMs = randomInt(MIN_BACKOFF_MS, Math.min(backoffMs * 2, MAX_BACKOFF_MS));
      }
    } finally {
      // takeover lock should be release anyway
      if (takeoverLocked) await this.unlockInternal(takeoverPath);
    }
  }

  protected static async unlockInternal(path: string, options?: { verify?: boolean }) {
    if (options?.verify) {
      const pid = await LockFile.getOwnerPid(path);
      if (pid !== process.pid)
        throw new LockFile.Error(path, `File is unexpectedly locked by another process ${pid}`);
    }
    await unlink(path);
  }

  [Symbol.asyncDispose]() {
    // idempotent because it's ok that lock is unlocked (unlike with handle)
    return this.unlock({ idempotent: true });
  }

  /** Read lock file and get PID of current lock owner */
  protected static async getOwnerPid(path: string) {
    let contents: string;
    try {
      contents = await readFile(path, { encoding: "utf-8" });
    } catch (err) {
      if (isErrnoException(err) && err.code === "ENOENT") {
        return undefined;
      }
      throw err;
    }

    // read pid of the process that owns the lock
    const match = /^(\d+)\n$/.exec(contents);
    if (match === null) {
      // another process only wrote partial file
      return undefined;
    }
    return Number(match[1]);
  }
}

/** Common options for both lock and unlock */
interface BaseOptions {
  /**
   * Verify that PID stored inside the file didn't change
   *
   * Can be used for debugging and stress testing.
   */
  verify?: boolean;
}

export namespace LockFile {
  export interface UnlockOptions extends BaseOptions {
    /** Do not fail if not locked */
    idempotent?: boolean;
  }

  export interface LockOptions extends BaseOptions {
    /* Lock timeout  */
    timeoutMs?: number;
  }

  /** Disposable handle for use with `using` directive */
  export class Handle implements AsyncDisposable {
    constructor(public readonly lockFile: LockFile) {}

    [Symbol.asyncDispose]() {
      return this.lockFile.unlock();
    }
  }

  export class Error extends LoggableError {
    protected static override namePrefix = "LockFile.";

    constructor(
      readonly path: string,
      msg: string,
      options?: { cause?: unknown },
    ) {
      super(`${msg}: ${path}`, options);
    }
  }

  export class Timeout extends Error {}
}

enum TryLockStatus {
  /** Lock succeeded */
  LOCK_SUCCESS,

  /**
   * Another process is currently locking/unlocking, retry after minimal backoff.
   *
   * This also may mean that the other process is stuck
   */
  ANOTHER_IN_PROGRESS,

  /** Locked by another process, retry after full backoff */
  LOCKED_ELSEWHERE,

  /** Leftover lock file after dead process */
  TAKEOVER_NEEDED,
}
