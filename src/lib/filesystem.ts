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
