import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { assert, assertNotNull } from "@sergei-dyshel/typescript/error";
import type { ValueOf } from "@sergei-dyshel/typescript/types";
import * as Cmd from "../cmdline-builder";
import { ParseError, type RunOptions, runCommand, splitOutput, withOut } from "./common";

export interface NumStat {
  insertions: number;
  deletions: number;
}

export namespace NumStat {
  export function sum(files: (FileStat | NumStat | undefined)[]) {
    const sum = { insertions: 0, deletions: 0 };
    for (const file of files) {
      if (file && (!("binary" in file) || !file.binary)) {
        sum.insertions += file.insertions;
        sum.deletions += file.deletions;
      }
    }
    return sum;
  }
}

export type FileStat = { binary: true } | ({ binary: false } & NumStat);

export const enum FileStatus {
  ADD = "A",
  DELETE = "D",
  RENAME = "R",
  COPY = "C",
  MODIFY = "M",
  TYPE_CHANGE = "T",
}

export interface File {
  mode: string;
  blob: string;
  path: string;
}

export type Entry =
  | {
      status: FileStatus.ADD;
      srcFile: undefined;
      dstFile: File;
    }
  | {
      status: FileStatus.DELETE;
      srcFile: File;
      dstFile: undefined;
    }
  | {
      status: FileStatus.MODIFY | FileStatus.TYPE_CHANGE;
      srcFile: File;
      dstFile: File;
    }
  | {
      status: FileStatus.RENAME | FileStatus.COPY;
      score: number;
      srcFile: File;
      dstFile: File;
    };

export namespace Entry {
  export function path(entry: Entry) {
    return (entry.dstFile?.path ?? entry.srcFile?.path)!;
  }
}

export type EntryWithStat = Entry & { stat: FileStat };

export type Result = Record<string, EntryWithStat>;

export const HASH_LEN = 40;

export interface Options {
  /**
   * Instead of showing the full 40-byte hexadecimal object name in diff-raw format output and
   * diff-tree header lines, show the shortest prefix that is at least <n> hexdigits long that
   * uniquely refers the object
   */
  abbrev?: number;

  /** Generate diff in raw format. */
  raw?: boolean;

  /**
   * Generate a diffstat. By default, as much space as necessary will be used for the filename part,
   * and the rest for the graph part. Maximum width defaults to terminal width, or 80 columns if not
   * connected to a terminal
   */

  stat?: boolean;
  /**
   * Similar to --stat, but shows number of added and deleted lines in decimal notation and pathname
   * without abbreviation, to make it more machine friendly. For binary files, outputs two - instead
   * of saying 0 0.
   */
  numstat?: boolean;

  /** This form is to view the changes you staged for the next commit relative to the named <commit>. */
  cached?: boolean;

  color?: boolean | "always" | "never" | "auto";

  /**
   * When --raw, --numstat, --name-only or --name-status has been given, do not munge pathnames and
   * use NULs as output field terminators.
   */
  nullTerminated?: boolean;
}

/**
 * Run `git diff`.
 *
 * Does not parses output. See:https://git-scm.com/docs/git-diff
 */
export async function raw(args: string | string[], options?: Options & RunOptions) {
  return runCommand("diff", typeof args === "string" ? [args] : args, diffSchema, options);
}

/** Like {@link raw} but parses output. */
export async function parse(
  args: string | string[],
  options?: Omit<Options, "nullTerminated" | "numstat" | "raw" | "abbrev"> & RunOptions,
) {
  const result = await raw(args, {
    ...deepMerge(options, withOut),
    abbrev: HASH_LEN,
    raw: true,
    numstat: true,
    nullTerminated: true,
  });
  const lines = splitOutput(result.stdout!, true /* nullTerminated */);
  try {
    return parseDiffOutput(lines);
  } catch (err) {
    throw ParseError.wrap(err, "Failed to parse git diff output", result.stdout!);
  }
}

function parseDiffOutput(origLines: string[]): Result {
  // make a copy so that original array stays intact in log
  const lines = [...origLines];
  const NULL_MODE = "000000";
  const NULL_HASH = "0".repeat(HASH_LEN);

  const result: Result = {};

  // when running `git dff --raw --numstat` it will output first lines for --raw and then
  // lines for --numstat
  while (lines.length > 0) {
    const line = lines.shift()!;
    if (line === "") {
      assert(lines.length === 0, "Empty line must come in the end");
      break;
    }
    if (line.startsWith(":")) {
      // --raw line, see https://git-scm.com/docs/git-diff#_raw_output_format
      const [srcMode, dstMode, srcBlob, dstBlob, statusScore] = line.substring(1).split(/\s+/);
      const status = statusScore[0] as FileStatus;
      const srcPath = lines.shift();
      assertNotNull(srcPath);
      const srcFile = { path: srcPath, mode: srcMode, blob: srcBlob };
      const dstFile = { path: srcPath, mode: dstMode, blob: dstBlob };
      const common = { srcFile, dstFile, stat: { binary: true } as FileStat };
      if (status === FileStatus.COPY || status === FileStatus.RENAME) {
        const score = Number(statusScore.substring(1));
        assert(!Number.isNaN(score), "Invalid score");
        const dstPath = lines.shift();
        assertNotNull(dstPath);
        result[dstPath] = {
          ...common,
          status,
          score,
          dstFile: { path: dstPath, mode: dstMode, blob: dstBlob },
        };
      } else if (status === FileStatus.ADD) {
        assert(srcMode === NULL_MODE);
        assert(srcBlob === NULL_HASH);
        result[srcPath] = {
          ...common,
          status,
          srcFile: undefined,
        };
      } else if (status === FileStatus.DELETE) {
        assert(dstMode === NULL_MODE);
        assert(dstBlob === NULL_HASH);
        result[srcPath] = {
          ...common,
          status,
          dstFile: undefined,
        };
      } else
        result[srcPath] = {
          ...common,
          status,
        };
    } else {
      // --numstat line, see https://git-scm.com/docs/git-diff#_other_diff_formats
      const [insertions, deletions, srcPath] = line.split(/\s+/);
      let entry: ValueOf<typeof result>;
      if (srcPath === "") {
        // copy/rename
        const srcPath = lines.shift();
        assertNotNull(srcPath);
        const dstPath = lines.shift();
        assertNotNull(dstPath);
        entry = result[dstPath];
        assertNotNull(entry, "Num stat file missing in raw entries");
        assert(
          (entry.status === FileStatus.COPY || entry.status === FileStatus.RENAME) &&
            entry.srcFile.path === srcPath,
          "Source path for numstat and raw entries does not math",
        );
      } else {
        entry = result[srcPath];
        assertNotNull(entry, "Num stat file missing in raw entries", srcPath);
      }
      if (insertions === "-") {
        assert(deletions === "-");
        entry.stat = { binary: true };
      } else {
        entry.stat = {
          binary: false,
          insertions: Number(insertions),
          deletions: Number(deletions),
        };
      }
    }
  }
  return result;
}

const diffSchema = Cmd.schema({
  abbrev: Cmd.number({ equals: true }),
  raw: Cmd.boolean(),
  stat: Cmd.boolean(),
  numstat: Cmd.boolean(),
  cached: Cmd.boolean(),
  color: Cmd.booleanString({ equals: true }),
});
