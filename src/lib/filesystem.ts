import type { DisposableLike } from "@sergei-dyshel/typescript";
import { normalizeArray } from "@sergei-dyshel/typescript/array";
import type { Arrayable, Awaitable } from "@sergei-dyshel/typescript/types";
import { type ChokidarOptions, type FSWatcher, watch } from "chokidar";
import type { EventName } from "chokidar/handler.js";
import * as fs from "node:fs";
import { constants, lstat, open, rename, rm } from "node:fs/promises";
import { AsyncContext } from "./async-context";
import { randomAlphaNumChars } from "./random";

export { emptyDir, pathExists as exists } from "fs-extra";

export function isDirectorySync(path: string) {
  try {
    const stat = fs.statSync(path);
    return stat.isDirectory();
  } catch (err) {
    const errno = err as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") return false;
    throw err;
  }
}

export async function isDirectory(path: string) {
  try {
    const stat = await fs.promises.stat(path);
    return stat.isDirectory();
  } catch (err) {
    const errno = err as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") return false;
    throw err;
  }
}

export async function isFile(path: string) {
  try {
    const stat = await fs.promises.stat(path);
    return stat.isFile();
  } catch (err) {
    const errno = err as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") return false;
    throw err;
  }
}

export function isFileSync(path: string) {
  try {
    const stat = fs.statSync(path);
    return stat.isFile();
  } catch (err) {
    const errno = err as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Write file atomically, by first writing to temprary file and then renaming it (atomically)
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  options?: {
    mtime?: Date;
  },
) {
  const tempPath = path + ".tmp." + randomAlphaNumChars(8);
  try {
    const file = await open(tempPath, constants.O_EXCL | constants.O_CREAT);
    try {
      await file.writeFile(data, { signal: AsyncContext.getSignal() });
      await file.sync();
      if (options?.mtime) {
        await file.utimes(options.mtime, options.mtime);
      }
    } finally {
      await file.close();
    }
    await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true });
  }
}

export async function isSymbolicLink(path: string) {
  try {
    const stat = await lstat(path);
    return stat.isSymbolicLink();
  } catch (err) {
    const errno = err as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") return false;
    throw err;
  }
}

export class FileWatcher implements DisposableLike {
  readonly watcher: FSWatcher;

  /**
   * Initalize watcher.
   *
   * @param options See {@link https://github.com/paulmillr/chokidar} for Chokidar options.
   */
  constructor(paths?: Arrayable<string>, options?: ChokidarOptions) {
    this.watcher = watch(normalizeArray(paths), options);
  }

  add(paths: Arrayable<string>) {
    this.watcher.add(normalizeArray(paths));
  }

  onChange(callback: (path: string) => Awaitable<void>) {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.watcher.on("change", callback);
  }

  onAny(callback: (event: EventName, path: string) => Awaitable<void>) {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.watcher.on("all", callback);
  }

  dispose() {
    void this.watcher.close();
  }
}
