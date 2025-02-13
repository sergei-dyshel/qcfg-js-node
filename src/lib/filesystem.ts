import type { Awaitable } from "@sergei-dyshel/typescript/types";
import * as fs from "node:fs";
import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathJoin } from "./path";

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

export class TempDirectory implements AsyncDisposable {
  private constructor(readonly name: string) {}

  static async create(options?: { prefix?: string; base?: string }) {
    const dir = await mkdtemp(join(options?.base ?? tmpdir(), options?.prefix ?? ""));
    return new TempDirectory(dir);
  }

  static async with<T>(
    fn: (path: string) => Awaitable<T>,
    options?: { prefix?: string; base?: string },
  ) {
    await using tempDir = await TempDirectory.create(options);
    return await fn(tempDir.name);
  }

  async writeFile(filename: string, text: string) {
    const filePath = pathJoin(this.name, filename);
    await writeFile(filePath, text);
    return filePath;
  }

  async [Symbol.asyncDispose]() {
    await rm(this.name, { recursive: true, force: true });
  }
}
