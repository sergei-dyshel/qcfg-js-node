import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { assert } from "@sergei-dyshel/typescript/error";
import * as Cmd from "../cmdline-builder";
import { type RunOptions, noCheck, runCommand, withOutErr } from "./common";

type FieldType<T extends string> = T extends `${string}Date` ? Date : string;

export type Entry = { [K in keyof typeof LOG_FORMAT]: FieldType<K> };

export interface LogOptions {
  /** Limit the number of commits to output. */
  maxCount?: number;

  /** Commit message matches pattern */
  grep?: string;

  /**
   * Consider the limiting patterns to be fixed strings (don’t interpret pattern as a regular
   * expression).
   */
  fixedStrings?: boolean;

  /** Show commits more recent than a specific date (commit date) */
  after?: DateArgType;

  /** Show commits older than a specific date (commit date) */
  before?: DateArgType;
}

/**
 * `git log`
 *
 * https://git-scm.com/docs/git-log
 *
 * This command only runs `git log` without parsing. For parsing use {@link parse}
 */
export async function raw(
  args?: string | string[],
  options?: {
    format?: string;
    date?: string;
    nullTerminated?: boolean;
  } & LogOptions &
    RunOptions,
) {
  return runCommand(
    "log",
    typeof args === "string" ? [args] : args,
    Cmd.schema({
      format: Cmd.string({ equals: true }),
      date: Cmd.string({ equals: true }),
      maxCount: Cmd.number({ equals: true }),
      grep: Cmd.string({ equals: true }),
      fixedStrings: Cmd.boolean(),
      after: Cmd.string({ equals: true }),
      before: Cmd.string({ equals: true }),
    }),
    { ...options, after: convertDate(options?.after), before: convertDate(options?.before) },
  );
}

/** Run {@link raw} and parse output. */
export async function parse(
  args?: string | string[],
  options?: LogOptions & RunOptions,
): Promise<Entry[]> {
  const keys = Object.keys(LOG_FORMAT);
  const formatStr = Object.values(LOG_FORMAT).join("%x01");
  const result = await raw(args, {
    ...deepMerge(options, withOutErr, noCheck),
    format: `format:${formatStr}`,
    nullTerminated: true,
  });
  if (result.checkFails() && result.stderr!.includes("does not have any commits yet")) return [];
  const output = result.stdout!;
  if (output === "") return [];
  return output.split("\0").map((commitOut) => {
    const fields = commitOut.split("\x01");
    assert(
      fields.length === keys.length,
      `Git logline does not match requested format: ${commitOut}`,
    );
    return Object.fromEntries(
      keys.map((key, i) => [key, key.endsWith("Date") ? new Date(fields[i]) : fields[i]]),
    ) as Entry;
  });
}

const LOG_FORMAT = {
  hash: "%H",
  authorName: "%an",
  authorEmail: "%ae",
  authorDate: "%aI",
  subject: "%s",
  body: "%b",
  committerName: "%cn",
  committerEmail: "%ce",
  committerDate: "%cI",
} as const;

type DateArgType = string | Date;

function convertDate(date?: DateArgType) {
  if (date === undefined && typeof date === "string") return date;
  return date?.toString();
}
