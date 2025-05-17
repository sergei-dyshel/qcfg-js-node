import { assert, assertNotNull } from "@sergei-dyshel/typescript/error";
import { canBeUndefined } from "@sergei-dyshel/typescript/types";
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

  private firstWrite = true;

  /**
   * Final destination output stream, either passed from outside or created from file
   */
  private dstStream!: NodeJS.WritableStream;

  private constructor(
    stream?: NodeJS.WritableStream,
    private readonly viewer?: string,
    private readonly filter?: ChildProcess,
    readonly filePath?: string,
    public file?: FileHandle,
  ) {
    if (stream) {
      assert(file === undefined);
      this.dstStream = stream;
    } else {
      assertNotNull(file);
      this.recreateFileStream();
    }
  }

  private recreateFileStream() {
    assertNotNull(this.file);
    if (this.filter) {
      // will be undefined when called in constructor
      if (canBeUndefined(this.dstStream)) {
        this.filter.stdout!.unpipe(this.dstStream);
        this.dstStream.end();
      }
    }
    this.dstStream = this.file.createWriteStream({
      // does seek(0) on fd
      start: 0,
      autoClose: false,
      // buffer size
      highWaterMark: 4096,
    });
    if (this.filter) {
      this.filter.stdout!.pipe(this.dstStream, { end: false });
    }
  }

  /** Should be called on first output to stream */
  private start() {
    if (this.firstWrite) {
      this.firstWrite = false;
      if (this.viewer && this.filePath) {
        this.runViewer();
      }
    }
  }

  get stream() {
    return this.filter ? this.filter.stdin! : this.dstStream;
  }

  runViewer() {
    if (this.filePath && this.viewer) void openViewer(this.filePath, this.viewer);
  }

  async write(buffer: Uint8Array | string, unfiltered?: boolean) {
    await writeStream(unfiltered ? this.dstStream : this.stream, buffer);
    this.start();
  }

  async truncate() {
    assertNotNull(this.file);
    await this.file.sync();
    await this.file.truncate(0);
    this.recreateFileStream();
    // this approach doesn't properly work with filter process, probably because
    // of the buffering along the output pipeline
  }

  async dispose() {
    if (this.filter) {
      this.filter.stdin!.end();
      if (this.filter.exitCode === null) {
        // if process already finished, the event will never happen and node process just exit
        await new Promise<void>((resolve) => {
          this.filter?.on("close", () => resolve());
        });
      }
    }
    if (this.file) {
      try {
        await this.file.sync();
        await this.file.close();
      } catch (err) {
        // swallow file errors (if it's closed already)
      }
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

    if (toStdout) {
      const logLevel = options.output === this.NO_OUTPUT ? LogLevel.DEBUG : LogLevel.INFO;
      logger.log(logLevel, "Writing to stdout");
      return new Output(process.stdout, viewer, filterProc);
    }

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
    return new Output(undefined /* stream */, viewer, filterProc, path, file);
  }

  static async createFile(path: string) {
    const file = await open(path, "w");
    return new Output(
      undefined /* file */,
      undefined /* viewer */,
      undefined /* filterProc */,
      path,
      file,
    );
  }

  async [Symbol.asyncDispose]() {
    await this.dispose();
  }
}
