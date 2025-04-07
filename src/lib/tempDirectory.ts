import type { Awaitable } from "@sergei-dyshel/typescript/types";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { userConfig } from "./config";
import { pathJoin, untildify } from "./path";

export interface TempDirectoryOptions {
  /** Directory name prefix */
  prefix?: string;
  /** Base directory, defaults to OS temp directory */
  base?: string;
  /** Whether to keep the directory on dispose */
  keep?: boolean;
}
export class TempDirectory implements AsyncDisposable {
  private constructor(
    readonly name: string,
    private readonly options?: TempDirectoryOptions,
  ) {}

  static async create(options?: TempDirectoryOptions) {
    let name = join(
      options?.base ?? (await userConfig.get()).baseTempDir ?? tmpdir(),
      options?.prefix ?? "",
    );
    // path must end with separator as `mkdtemp` just adds random characters to it as is
    if (!name.endsWith(sep)) name += sep;
    const dir = await mkdtemp(untildify(name));
    return new TempDirectory(dir, options);
  }

  static async with<T>(fn: (path: string) => Awaitable<T>, options?: TempDirectoryOptions) {
    await using tempDir = await TempDirectory.create(options);
    return await fn(tempDir.name);
  }

  async writeFile(filename: string, text: string) {
    const filePath = pathJoin(this.name, filename);
    await writeFile(filePath, text);
    return filePath;
  }

  filePath(filename: string) {
    return pathJoin(this.name, filename);
  }

  async [Symbol.asyncDispose]() {
    if (!this.options?.keep) await rm(this.name, { recursive: true, force: true });
  }
}
