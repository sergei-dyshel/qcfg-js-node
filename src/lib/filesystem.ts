import type { Awaitable } from "@sergei-dyshel/typescript/types";
import * as fs from "node:fs";
import { lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

export async function withTempDirectory<T>(
  fn: (path: string) => Awaitable<T>,
  options?: { prefix?: string; base?: string },
) {
  const path = await fs.promises.mkdtemp(join(options?.base ?? tmpdir(), options?.prefix ?? ""));
  try {
    return await fn(path);
  } finally {
    await rm(path, { recursive: true, force: true });
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
