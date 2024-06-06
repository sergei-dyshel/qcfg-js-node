import type { Awaitable } from "@sergei-dyshel/typescript/types";
import * as fs from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export { emptyDir, pathExists } from "fs-extra";

export function isDirectorySync(path: string) {
  const stat = fs.statSync(path);
  return stat.isDirectory();
}

export async function isDirectory(path: string) {
  const stat = await fs.promises.stat(path);
  return stat.isDirectory();
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
