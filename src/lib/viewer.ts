import { assertNotNull } from "@sergei-dyshel/typescript/error";
import type { ChildProcess } from "node:child_process";
import { type FileHandle, open } from "node:fs/promises";
import { userConfig } from "./config";
import { ModuleLogger } from "./logging";
import { shlex } from "./shlex";
import { writeStream } from "./stream";
import { run } from "./subprocess";
import { TempDirectory } from "./tempDirectory";

const logger = new ModuleLogger();

export async function getDefaultViewer() {
  return (await userConfig.get()).viewer;
}

export function openViewer(path: string, viewer: string) {
  const cmdStr = viewer;
  assertNotNull(cmdStr, "Default viewer is not defined in config");
  const cmd = shlex.split(cmdStr);
  logger.debug(`Opening viewer: ${cmdStr} ${path}`);
  cmd.push(path);
  return run(cmd);
}

/**
 * Helper class for command-line programs that can write output to stdout/file and optionally pipe
 * through filter/transformer command
 */
export class Output implements AsyncDisposable {
  readonly stream: NodeJS.WritableStream;
  private readonly viewer?: string;
  private readonly filter?: ChildProcess;
  private readonly filePath?: string;
  private readonly file?: FileHandle;

  private firstWrite = true;

  private constructor(
    stream: NodeJS.WritableStream,
    viewer?: string,
    filter?: ChildProcess,
    filePath?: string,
    file?: FileHandle,
  ) {
    this.stream = stream;
    this.viewer = viewer;
    this.filter = filter;
    this.filePath = filePath;
    this.file = file;
  }

  /** Should be called on first output to stream */
  start() {
    if (this.firstWrite && this.filePath) {
      this.firstWrite = false;
      void openViewer(this.filePath, this.viewer!);
    }
  }

  async write(buffer: Uint8Array | string) {
    this.start();
    return writeStream(this.stream, buffer);
  }

  async dispose() {
    if (this.filter) {
      this.filter.kill();
      await new Promise((resolve) => {
        this.filter?.on("close", resolve);
      });
    }
    if (this.file) await this.file.close();
  }

  static async create(options: {
    /** Output filename paramter as passed to CLI flags. Special value "-" forces output to stdout */
    output?: string;
    /** Default output filename when flag is not given to CLI */
    defaultFilename: string;
    /** Viewer command */
    viewer?: string;
    /** Filter command */
    filter?: string;
  }): Promise<Output> {
    const viewer = options.viewer ?? (await getDefaultViewer());
    const toStdout =
      options.output === "-" ||
      (options.output === undefined && (!viewer || !process.stdout.isTTY));

    let filterProc: ChildProcess | undefined;
    if (options.filter) {
      const filter = options.filter;
      logger.debug(`Piping through filter: ${filter}`);
      filterProc = run(shlex.split(filter), {
        stdin: "pipe",
        stdout: toStdout ? undefined : "pipe",
      }).child;
    }

    if (toStdout)
      return new Output(filterProc ? filterProc.stdin! : process.stdout, viewer, filterProc);

    const path = await (async () => {
      let filename: string;
      if (options.output) {
        if (options.output.includes("/")) return options.output;
        // TODO: allow output be a directory name, in that case create a file with defaultFilename inside it
        filename = options.output;
      } else {
        filename = options.defaultFilename;
      }
      const tempDir = await TempDirectory.create();
      return tempDir.filePath(filename);
    })();
    const file = await open(path, "w");
    logger.debug(`Writing to file ${path}`);
    const fileStream = file.createWriteStream();
    if (filterProc) {
      filterProc.stdout!.pipe(fileStream);
    }
    return new Output(fileStream, viewer, filterProc, path, file);
  }

  async [Symbol.asyncDispose]() {
    await this.dispose();
  }
}
