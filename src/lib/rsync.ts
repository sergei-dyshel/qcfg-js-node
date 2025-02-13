import { normalizeArray } from "@sergei-dyshel/typescript/array";
import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { assert } from "@sergei-dyshel/typescript/error";
import "@sergei-dyshel/typescript/shims";
import * as Cmd from "./cmdline-builder";
import { userConfig, type UserConfigType } from "./config";
import { TempDirectory } from "./filesystem";
import { run, type Runner, type RunOptions } from "./subprocess";

/**
 * Used to construct parameter value for `--info` See {@link https://www.mankier.com/1/rsync#--info}.
 *
 * Current output of `--info=help`:
 *
 * ```text
 * Use OPT or OPT1 for level 1 output, OPT2 for level 2, etc.; OPT0 silences.
 *
 * BACKUP     Mention files backed up
 * COPY       Mention files copied locally on the receiving side
 * DEL        Mention deletions on the receiving side
 * FLIST      Mention file-list receiving/sending (levels 1-2)
 * MISC       Mention miscellaneous information (levels 1-2)
 * MOUNT      Mention mounts that were found or skipped
 * NAME       Mention 1) updated file/dir names, 2) unchanged names
 * NONREG     Mention skipped non-regular files (default 1, 0 disables)
 * PROGRESS   Mention 1) per-file progress or 2) total transfer progress
 * REMOVE     Mention files removed on the sending side
 * SKIP       Mention files skipped due to transfer overrides (levels 1-2)
 * STATS      Mention statistics at end of run (levels 1-3)
 * SYMSAFE    Mention symlinks that are unsafe
 *
 * ALL        Set all --info options (e.g. all4)
 * NONE       Silence all --info options (same as all0)
 * HELP       Output this help message
 *
 * Options added at each level of verbosity:
 * 0) NONREG
 * 1) COPY,DEL,FLIST,MISC,NAME,STATS,SYMSAFE
 * 2) BACKUP,MISC2,MOUNT,NAME2,REMOVE,SKIP
 * ```
 */
export type RsyncInfoOptions = Partial<
  Record<
    // Mention 1) updated file/dir names, 2) unchanged names
    | "name"
    // Mention 1) per-file progress or 2) total transfer progress
    | "progress"
    // Mention statistics at end of run (levels 1-3)
    | "stats",
    boolean | number
  >
>;

export interface RsyncOptions {
  /** Path to local rsync binary or wrapper script */
  localRsyncPath?: string;
  runner?: Runner;
  run?: RunOptions;

  /** List of files to sync. Will be copied to temp file and passed as `--files-from` */
  files?: string[] | string;

  // Transformed to `--include/exclude` options.
  include?: string[];
  exclude?: string[];

  /**
   * Path to remote rsync binary or wrapper script on remote machine.
   *
   * Can be overriden with user-config (see {@link UserConfigType.rsync}).
   */
  remoteRsyncPath?: string;

  /** Fine-grained informational verbosity */
  info?: RsyncInfoOptions;

  //
  // Custom --info configurations, can be combined.
  // NOTE: not supported on old versions of rsync.
  //

  /** Show file names transferred, shortcut for --info=name */
  names?: boolean;
  /** Show total progress during transfer, shortcut for --info=progress2 */
  progress?: boolean;
  /** Show transfer stats, shortcut for --info=stats1 */
  stats?: boolean;

  //
  // rsync options passed as-is
  //

  /** Skip files that are newer on the receiver */
  update?: boolean;
  /** Skip based on checksum, not mod-time & size */
  checksum?: boolean;
  // IMPROVE: make it a number
  verbose?: boolean;
  quiet?: boolean;

  /** Archive mode -rlptgoD: recursive, links, perms, times, groups, owner */
  archive?: boolean;
  /** Copy directories recursively */
  recursive?: boolean;
  /** Copy symlinks as symlink */
  links?: boolean;
  /** Preserve permissions */
  perms?: boolean;
  /** Preserve modification times */
  times?: boolean;
  /** Preserve group */
  group?: boolean;
  /** Preserve owner */
  owner?: boolean;

  /** Omit directories from `times` */
  omitDirTimes?: boolean;
  /** Transform symlink into referent file/dir */
  copyLinks?: boolean;
  /** Skip creating new files on receiver */
  existing?: boolean;
  /** Read list of source-file names from FILE */
  filesFrom?: string;
}

const cmdSchema = Cmd.schema({
  verbose: Cmd.boolean(),
  quiet: Cmd.boolean(),
  update: Cmd.boolean(),
  checksum: Cmd.boolean(),
  archive: Cmd.boolean(),
  recursive: Cmd.boolean(),
  links: Cmd.boolean(),
  parms: Cmd.boolean(),
  times: Cmd.boolean(),
  group: Cmd.boolean(),
  owner: Cmd.boolean(),
  omitDirTimes: Cmd.boolean(),
  copyLinks: Cmd.boolean(),
  existing: Cmd.boolean(),
  filesFrom: Cmd.string({ equals: true }),
});

const defaultRunOptions: RunOptions = {
  check: true,
};

export async function rsync(args: string[], options?: RsyncOptions) {
  const files = normalizeArray(options?.files);
  await using stack = new AsyncDisposableStack();
  const customOptions: RsyncOptions = { info: {} };
  if (files.length > 0) {
    assert(!options?.filesFrom, `Can not use both "files" and "filesFrom" flags`);
    const tempDir = stack.use(await TempDirectory.create());
    const filesFile = await tempDir.writeFile("files", files.join("\n"));
    customOptions.filesFrom = filesFile;
  }
  const config = (await userConfig.get()).rsync;
  customOptions.remoteRsyncPath = config?.defaultRemoteRsyncPath;
  if (options?.names) customOptions.info!.name = true;
  if (options?.progress) customOptions.info!.progress = 2;
  if (options?.stats) customOptions.info!.stats = true;
  const opts = deepMerge(customOptions, options);
  const cmdArgs = Cmd.build(cmdSchema, opts);

  if (!!options?.include || !!options?.exclude) {
    if (options.exclude)
      for (const pattern of options.exclude) {
        cmdArgs.push("--exclude", pattern);
      }
    if (options.include) {
      for (const pattern of options.include) {
        cmdArgs.push("--include", pattern);
      }
      cmdArgs.push("--include", "*/", "--exclude", "*");
    }
  }

  if (opts.info) {
    const infoStr = Object.entries(opts.info)
      .map(([name, level]) => {
        const levelStr = typeof level === "number" ? level.toString() : "";
        return `${name}${levelStr}`;
      })
      .join(",");
    if (infoStr !== "") cmdArgs.push("--info=" + infoStr);
  }

  const bin = options?.localRsyncPath ?? "rsync";
  return await (options?.runner ?? run)(
    [bin, ...cmdArgs, ...args],
    deepMerge(defaultRunOptions, options?.run),
  );
}
