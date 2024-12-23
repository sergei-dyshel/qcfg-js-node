import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { assert } from "@sergei-dyshel/typescript/error";
import * as Cmd from "../cmdline-builder";
import { type RunOptions, runCommand, withOutErr } from "./common";

type FieldType<T extends string> = T extends `${string}Date` ? Date : string;

export type Entry = { [K in keyof typeof LOG_FORMAT]: FieldType<K> };

/**
 * `git log`
 *
 * https://git-scm.com/docs/git-log
 *
 * This command only runs `git log` without parsing. For parsing use {@link parse}
 */
export async function raw(
  args: string | string[],
  options?: {
    format?: string;
    date?: string;
    nullTerminated?: boolean;
  } & RunOptions,
) {
  return runCommand(
    "log",
    typeof args === "string" ? [args] : args,
    Cmd.schema({ format: Cmd.string({ equals: true }), date: Cmd.string({ equals: true }) }),
    options,
  );
}

/** Run {@link raw} and parse output. */
export async function parse(args: string | string[], options?: RunOptions): Promise<Entry[]> {
  const keys = Object.keys(LOG_FORMAT);
  const formatStr = Object.values(LOG_FORMAT).join("%x01");
  const output = (
    await raw(args, {
      ...deepMerge(options, withOutErr),
      format: `format:${formatStr}`,
      nullTerminated: true,
    })
  ).stdout!;
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
