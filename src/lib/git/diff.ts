import { assert, assertNotNull } from "@sergei-dyshel/typescript/error";
import type { ValueOf } from "@sergei-dyshel/typescript/types";

export interface GitNumStat {
  insertions: number;
  deletions: number;
}

export namespace GitNumStat {
  export function sum(files: (GitDiffFileStat | GitNumStat | undefined)[]) {
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

export type GitDiffFileStat = { binary: true } | ({ binary: false } & GitNumStat);

export const enum GitDiffFileStatus {
  ADD = "A",
  DELETE = "D",
  RENAME = "R",
  COPY = "C",
  MODIFY = "M",
  TYPE_CHANGE = "T",
}

export interface GitDiffFile {
  mode: string;
  blob: string;
  path: string;
}

export type GitDiffEntry =
  | {
      status: GitDiffFileStatus.ADD;
      srcFile: undefined;
      dstFile: GitDiffFile;
    }
  | {
      status: GitDiffFileStatus.DELETE;
      srcFile: GitDiffFile;
      dstFile: undefined;
    }
  | {
      status: GitDiffFileStatus.MODIFY | GitDiffFileStatus.TYPE_CHANGE;
      srcFile: GitDiffFile;
      dstFile: GitDiffFile;
    }
  | {
      status: GitDiffFileStatus.RENAME | GitDiffFileStatus.COPY;
      score: number;
      srcFile: GitDiffFile;
      dstFile: GitDiffFile;
    };

export namespace GitDiffEntry {
  export function path(entry: GitDiffEntry) {
    return (entry.dstFile?.path ?? entry.srcFile?.path)!;
  }
}

export type GitDiffEntryWithStat = GitDiffEntry & { stat: GitDiffFileStat };

export type GitDiffResult = Record<string, GitDiffEntryWithStat>;

export const HASH_LEN = 40;

export function parseDiffOutput(origLines: string[]): GitDiffResult {
  // make a copy so that original array stays intact in log
  const lines = [...origLines];
  const NULL_MODE = "000000";
  const NULL_HASH = "0".repeat(HASH_LEN);

  const result: GitDiffResult = {};

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
      const status = statusScore[0] as GitDiffFileStatus;
      const srcPath = lines.shift();
      assertNotNull(srcPath);
      const srcFile = { path: srcPath, mode: srcMode, blob: srcBlob };
      const dstFile = { path: srcPath, mode: dstMode, blob: dstBlob };
      const common = { srcFile, dstFile, stat: { binary: true } as GitDiffFileStat };
      if (status === GitDiffFileStatus.COPY || status === GitDiffFileStatus.RENAME) {
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
      } else if (status === GitDiffFileStatus.ADD) {
        assert(srcMode === NULL_MODE);
        assert(srcBlob === NULL_HASH);
        result[srcPath] = {
          ...common,
          status,
          srcFile: undefined,
        };
      } else if (status === GitDiffFileStatus.DELETE) {
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
          (entry.status === GitDiffFileStatus.COPY || entry.status === GitDiffFileStatus.RENAME) &&
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
