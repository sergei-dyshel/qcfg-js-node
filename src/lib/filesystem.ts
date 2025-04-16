import type { DisposableLike } from "@sergei-dyshel/typescript";
import type { Awaitable } from "@sergei-dyshel/typescript/types";
import { type ChokidarOptions, type FSWatcher, watch } from "chokidar";
import type { EventName } from "chokidar/handler.js";
import * as fs from "node:fs";
import { lstat } from "node:fs/promises";

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
  watcher: FSWatcher;

  constructor(paths: string | string[], options?: ChokidarOptions) {
    this.watcher = watch(paths, options);
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
