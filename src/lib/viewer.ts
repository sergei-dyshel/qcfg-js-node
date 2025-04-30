import { assertNotNull } from "@sergei-dyshel/typescript/error";
import type { ChildProcess } from "node:child_process";
import { type FileHandle, open } from "node:fs/promises";
import { userConfig } from "./config";
import { isDirectory } from "./filesystem";
import { LogLevel, ModuleLogger } from "./logging";
import { pathJoin } from "./path";
import { shlex } from "./shlex";
import { writeStream } from "./stream";
import { run } from "./subprocess";
import { TempDirectory } from "./tempDirectory";

const logger = new ModuleLogger();

// REFACTOR: move all stuff into Output
export const NO_VIEWER = "-";

export async function getDefaultViewer() {
  return (await userConfig.get()).viewer;
}

export function openViewer(path: string, viewer: string) {
  if (viewer === NO_VIEWER) {
    return;
  }
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
  static readonly NO_OUTPUT = "-";

  readonly stream: NodeJS.WritableStream;
  private readonly viewer?: string;
  private readonly filter?: ChildProcess;
  readonly filePath?: string;
  readonly file?: FileHandle;

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
    if (this.viewer && this.firstWrite && this.filePath) {
      this.firstWrite = false;
      this.runViewer();
    }
  }

  runViewer() {
    if (this.filePath && this.viewer) void openViewer(this.filePath, this.viewer);
  }

  async write(buffer: Uint8Array | string) {
    this.start();
    return writeStream(this.stream, buffer);
  }

  async truncate() {
    assertNotNull(this.file);
    await this.file.truncate(0);
  }

  async dispose() {
    if (this.filter) {
      this.filter.stdin!.end();
      await new Promise((resolve) => {
        this.filter?.on("close", resolve);
      });
    }
    if (this.file) {
      await this.file.sync();
      await this.file.close();
    }
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
      options.output === this.NO_OUTPUT ||
      (options.output === undefined && (!viewer || !process.stdout.isTTY));

    let filterProc: ChildProcess | undefined;
    if (options.filter) {
      const filter = options.filter;
      logger.debug(`Piping through filter: ${filter}`);
      filterProc = run(shlex.split(filter), {
        stdin: "pipe",
        stdout: toStdout ? undefined : "pipe",
        // otherwise uncaught abort signal will crash entire process
        signal: null,
      }).child;
    }

    if (toStdout)
      return new Output(filterProc ? filterProc.stdin! : process.stdout, viewer, filterProc);

    const path = await (async () => {
      let filename: string;
      let dirname: string | undefined = undefined;
      if (options.output) {
        if (await isDirectory(options.output)) {
          dirname = options.output;
          filename = options.defaultFilename;
        } else if (options.output.includes("/")) return options.output;
        else filename = options.output;
      } else {
        filename = options.defaultFilename;
      }
      if (!dirname) dirname = (await TempDirectory.create()).name;
      return pathJoin(dirname, filename);
    })();
    const file = await open(path, "w");
    // if output filename may be needed by user, increase level
    const fileLogLevel = path === options.output ? LogLevel.INFO : LogLevel.WARNING;
    logger.log(fileLogLevel, `Writing to file ${path}`);
    const fileStream = file.createWriteStream();
    if (filterProc) {
      filterProc.stdout!.pipe(fileStream, { end: false });
    }
    return new Output(filterProc ? filterProc.stdin! : fileStream, viewer, filterProc, path, file);
  }

  static async createFile(path: string) {
    const file = await open(path, "w");
    const fileStream = file.createWriteStream();
    return new Output(fileStream, undefined /* viewer */, undefined /* filterProc */, path, file);
  }

  async [Symbol.asyncDispose]() {
    await this.dispose();
  }
}
