/** Remote branch */
// const BRANCH = "syg";

import { normalizeArray } from "@sergei-dyshel/typescript/array";
import { assert, assertNotNull, LoggableError } from "@sergei-dyshel/typescript/error";
import { mapValuesAsync, objectEntries } from "@sergei-dyshel/typescript/object";
import { dedent } from "@sergei-dyshel/typescript/string";
import { canBeUndefined } from "@sergei-dyshel/typescript/types";
import { createSymlink, mkdir, move, rm } from "fs-extra";
import { appendFile, readFile, readlink, unlink, writeFile } from "fs/promises";
import { dirname, isAbsolute } from "path";
import * as semver from "semver";
import { Ssh, type Subprocess } from ".";
import { userConfig } from "./config";
import { exists, isSymbolicLink } from "./filesystem";
import { Git } from "./git";
import { ModuleLogger } from "./logging";
import { absPath, pathJoin } from "./path";
import type { Command } from "./subprocess";

/**
 * Store git config file that is used for syg config too outside of syg git dir this way it can be
 * backed up without including whole syg git dir
 */
const CONFIG_FILE = ".syg.config";

const DEFAULT_REMOTE_KEY = "syg.defaultRemote";

/** Max commits in git log before squashing */
// const MAX_GIT_LOG_LEN = 50;

const MIN_GIT_VERSION = "2.40.1";

// const ADD_PATHSPEC = ".syg.add";

const SYG_GIT = ".syg.git";

const BRANCH = "syg";

/** Commit message used for commit with added files */
const ADD_COMMIT_MSG = "+ syg";

const logger = new ModuleLogger({ name: "syg" });

export class Syg {
  /**
   * File with patterns to ignore when syncing
   */
  static readonly IGNORE_FILE = ".syg.gitignore";

  readonly cwd?: string;
  readonly root?: string;

  /** Pass --verbose to all git commands */
  readonly gitVerbose?: boolean;

  // git instance for regular git repo
  readonly git: Git.Instance;

  // git instance for syg git repo
  readonly sygGit: Git.Instance;

  readonly sygGitDir: string;
  readonly gitDir: string;

  private cachedRemotes: Record<string, Syg.RemoteInfo> | undefined;

  constructor(options?: Syg.Options) {
    this.cwd = options?.cwd;
    this.root = options?.root ?? options?.cwd;
    this.gitVerbose = options?.gitVerbose;
    this.sygGitDir = pathJoin(this.root, SYG_GIT);
    this.sygGit = new Git.Instance({
      gitDir: this.sygGitDir,
      workTree: this.root ?? ".",
      log: { prefix: "+ [syg.git] " },
    });
    this.gitDir = pathJoin(this.root, Git.DEFAULT_GIT_DIR);
    this.git = new Git.Instance({
      gitDir: this.gitDir,
      workTree: this.root ?? ".",
    });
  }

  /**
   * Find syg root directory in current or parent directories of {@link Syg.BaseOptions.cwd}.
   *
   * Throw error if not found.
   */
  static async detect(options?: Syg.BaseOptions): Promise<Syg> {
    const root = await Git.RevParse.showToplevel({ cwd: options?.cwd });
    logger.debug(`Git repo root: ${root}`);
    const syg = new Syg({ ...options, root });
    await syg.checkSygGitDir();
    return syg;
  }

  async init(options?: {
    /** Force initialize (if init = true) */
    force?: boolean;
  }) {
    await this.checkGitDir();
    let sygGitExists = await exists(this.sygGitDir);
    if (options?.force) {
      if (sygGitExists) {
        logger.debug("Removing existing syg git dir");
        await rm(this.sygGitDir, { recursive: true });
        sygGitExists = false;
      }
    }
    if (sygGitExists) {
      logger.debug("Syg git dir already exists");
    } else {
      logger.info("Initializing syg git dir in current directory");
      await this.sygGit.init({
        template: "",
        initialBranch: BRANCH,
        quiet: !this.gitVerbose,
      });
      await this.sygGit.commit({
        allowEmpty: true,
        message: "First commit",
        quiet: !this.gitVerbose,
        verbose: this.gitVerbose,
      });
    }
    await mkdir(pathJoin(this.sygGitDir, "info"), { recursive: true });
    await this.moveConfigOut();
  }

  async addRemote(
    name: string,
    host: string,
    directory?: string,
    options?: { setDefault?: boolean; setup?: boolean },
  ): Promise<Syg.RemoteInfo> {
    if (!directory) directory = process.cwd();
    if (!isAbsolute(directory)) throw new Syg.Error("Remote directory must be absolute path");
    const url = `${host}:${directory}`;
    await this.sygGit.remoteAdd(name, url);
    this.clearCachedRemotes();
    if (options?.setDefault) await this.setDefaultRemote(name);
    if (options?.setup) await this.setupRemote(name);
    return { name, host, directory };
  }

  async setRemoteGitBinDir(gitBin: string, remote?: string) {
    await this.sygGit.setConfigRemote(
      await this.checkRemote(remote),
      "receivepack",
      pathJoin(gitBin, "git-receive-pack"),
      {
        local: true,
      },
    );
  }

  /**
   * Get mapping from remote name to {@link Syg.RemoteInfo}.
   */
  async getRemotes(options?: { noDefault?: boolean }): Promise<Record<string, Syg.RemoteInfo>> {
    const gitRemotes = await this.sygGit.remoteList();
    const defaultRemote = options?.noDefault ? null : await this.getDefaultRemote();
    return mapValuesAsync(gitRemotes, async (remote, remoteInfo) => {
      assertNotNull(remoteInfo.fetch);
      const receivePack = await this.sygGit.getConfigRemote(remote, "receivepack", { local: true });
      const info: Syg.RemoteInfo = {
        name: remote,
        host: remoteInfo.fetch.protocol,
        directory: remoteInfo.fetch.pathname,
        gitBinDir: receivePack ? dirname(receivePack) : undefined,
      };
      if (defaultRemote !== null) info.isDefault = remote === defaultRemote;
      return info;
    });
  }

  public async getRemoteInfo(
    remote?: string,
    options?: { noCache?: boolean; notRequired?: false | undefined },
  ): Promise<Syg.RemoteInfo>;
  public async getRemoteInfo(
    remote?: string,
    options?: { noCache?: boolean; notRequired: true },
  ): Promise<Syg.RemoteInfo | undefined>;
  public async getRemoteInfo(
    remote?: string,
    options?: { noCache?: boolean; notRequired?: boolean },
  ) {
    if (options?.noCache ?? this.cachedRemotes === undefined)
      this.cachedRemotes = await this.getRemotes();
    if (!remote)
      remote = await this.getDefaultRemote({ check: !options?.notRequired, allowOnly: true });
    if (!remote) {
      return undefined;
    }
    const remoteInfo = this.cachedRemotes[remote] as Syg.RemoteInfo | undefined;
    if (!options?.notRequired && !remoteInfo) throw new Syg.Error(`Remote ${remote} not found`);
    return remoteInfo;
  }

  async setupRemote(remote?: string) {
    const remoteInfo = await this.getRemoteInfo(remote);
    await this.verifyRemoteGitVersion(remoteInfo);
    const remoteGit = await this.remoteGit(remoteInfo);
    await remoteGit.setConfig("receive.denyCurrentBranch", "updateInstead");
    await remoteGit.setConfig("receive.shallowUpdate", true);
    await remoteGit.checkout([], {
      branchForce: `${BRANCH}-presetup-backup`,
      quiet: !this.gitVerbose,
    });
    await remoteGit.add([], { update: true });
    await remoteGit.commit({ message: "+", allowEmpty: true, quiet: true });
    await remoteGit.checkout([], { branchForce: BRANCH, quiet: !this.gitVerbose });

    await remoteGit.setConfig("core.hooksPath", "hooks");
    const ssh = await this.remoteSsh(remoteInfo);
    await ssh.writeFile(".git/hooks/pre-receive", preReceiveHook, { mode: 0o755 });
    await ssh.writeFile(".git/hooks/push-to-checkout", pushToCheckoutHook, { mode: 0o755 });
  }

  async getDefaultRemote(options: { check: true; allowOnly?: boolean }): Promise<string>;
  async getDefaultRemote(options?: {
    /** Throw if can't determine default remote */
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    check?: false | boolean;
    /** If default remote is not set but there is only one remote defined, return it */
    allowOnly?: boolean;
  }): Promise<string | undefined>;
  async getDefaultRemote(options?: { check?: boolean; allowOnly?: boolean }) {
    let remote = await this.sygGit.getConfigCustom(DEFAULT_REMOTE_KEY, { local: true });
    // getRemotes should not call recursively to itself via getDefaultRemote
    const remotes = await this.getRemotes({ noDefault: true });
    if (remote && !canBeUndefined(remotes[remote])) {
      logger.error(`Default remote ${remote} is not a remote`);
      await this.unsetDefaultRemote();
      remote = undefined;
    }
    if (!remote && options?.allowOnly) {
      const remoteNames = Object.keys(remotes);
      if (remoteNames.length === 1) remote = remoteNames[0];
    }
    if (options?.check && !remote) throw new Syg.NoDefaultRemote("Default remote is not set");
    return remote;
  }

  /**
   * Verify that all requested remotes are valid. If no remotes requested, verify that at least one
   * remote exists and return list containing of default remote or single remote.
   */
  private async checkRemotes(remotes?: string[]): Promise<string[]> {
    const allRemotes = await this.getRemotes({ noDefault: true });
    if (remotes && remotes.length > 0) {
      for (const remote of remotes) assert(remote in allRemotes, `Remote ${remote} does not exist`);
      return remotes;
    }
    return [await this.getDefaultRemote({ allowOnly: true, check: true })];
  }

  private async checkRemote(remote?: string) {
    const allRemotes = await this.getRemotes({ noDefault: true });
    if (remote) {
      assert(remote in allRemotes, `Remote ${remote} does not exist`);
      return remote;
    } else {
      return await this.getDefaultRemote({ allowOnly: true, check: true });
    }
  }

  async setDefaultRemote(remote: string, options?: { noCheck?: boolean }) {
    if (!options?.noCheck && (await this.getDefaultRemote()) !== remote) {
      logger.info(`Setting default remote to ${remote}`);
    }
    await this.sygGit.setConfigCustom(DEFAULT_REMOTE_KEY, remote, { local: true });
    this.clearCachedRemotes();
  }

  async unsetDefaultRemote() {
    await this.sygGit.unsetConfigCustom(DEFAULT_REMOTE_KEY, { local: true });
  }

  /**
   * Rename remote and preserve default flag
   */
  async renameRemote(oldName: string, newName: string) {
    const old = await this.getRemoteInfo(oldName);
    await this.sygGit.remoteRename(oldName, newName);
    if (old.isDefault) {
      await this.setDefaultRemote(newName, { noCheck: true });
      logger.info(`Renamed DEFAULT remote "${oldName} to ${newName}"`);
    } else {
      logger.info(`Renamed remote "${oldName} to ${newName}"`);
    }
  }

  /**
   * Sychronize new changes to one or more remotes.
   *
   * Return if any of remotes were indeed updated.
   */
  async sync(options?: {
    /** Remotes to sync. If not given will sync default remote. */
    remotes?: string[];
    /** Only sync these file paths/pathspecs. */
    pathspecs?: string[];
  }): Promise<boolean> {
    const remotesToSync = await this.checkRemotes(options?.remotes);
    // make syg comit history as local repo
    const head = await this.git.revParseHead();
    logger.debug(`Local head: ${head}`);
    if (!(await this.sygGit.commitExists(head)))
      await this.sygGit.fetch([this.root ?? ".", head], { quiet: !this.gitVerbose });

    const log = await this.sygGit.logParse(undefined, { maxCount: 2 });
    // syg head is "add commit" on top repo head, so we can just amend all changed files to it
    let addCommit =
      log[0].subject === ADD_COMMIT_MSG && log[1].hash === head ? log[0].hash : undefined;
    if (addCommit) logger.debug(`"add commit" present`);

    if (!addCommit) await this.sygGit.reset(head, { quiet: !this.gitVerbose });

    // prevent ignored files being added on git add
    await this.updateInfoExclude();
    await this.sygGit.add(options?.pathspecs, { all: true });

    // check if there are staged files
    const diff = await this.sygGit.diffParse(Git.HEAD, { cached: true });
    if (objectEntries(diff).length !== 0) {
      logger.debug("Worktree has changes since the last commit");
      await this.sygGit.commit({
        message: ADD_COMMIT_MSG,
        quiet: !this.gitVerbose,
        // ammend to "add commit"
        amend: !!addCommit,
      });
      addCommit = await this.sygGit.revParseHead();
    }

    let anyRemoteUpdated = false;
    for (const remote of remotesToSync) {
      logger.info(`Syncing ${remote}`);
      const remoteHead = await this.sygGit.revParse(`remotes/${remote}/${BRANCH}`, {
        verify: true,
        quiet: true,
      });
      logger.debug(`Remote head: ${remoteHead}`);
      if (!remoteHead) {
        logger.debug("First sync, fetching remote");
        await this.sygGit.fetch([remote, BRANCH], { quiet: !this.gitVerbose });
      }
      await this.sygGit.diffRaw(`${remote}/${BRANCH}`, {
        noPager: true,
        cached: true,
        stat: true,
      });
      if (remoteHead === (addCommit ?? head)) {
        // if there are no changes on top of normal repo head, push anyway
        logger.info("Remote is already up to date, not pushing");
        continue;
      }

      await this.sygGit.push(remote, {
        force: true,
        verify: false,
        quiet: !this.gitVerbose,
        verbose: this.gitVerbose,
      });
      anyRemoteUpdated = true;
    }

    return anyRemoteUpdated;
  }

  /**
   * Ignore file(s), i.e. remove from sync set.
   *
   * Returns true if any new file was ignored.
   */
  async ignore(path: string | string[]) {
    const paths = normalizeArray(path);
    await this.sygGit.rm(paths, { cached: true, ignoreUnmatch: true });
    let ignoredAny = false;
    for (const path of paths) {
      if (await this.sygGit.isIgnored(path)) {
        logger.info(`${path} is already ignored`);
        continue;
      }
      ignoredAny = true;
      await appendFile(pathJoin(this.root, Syg.IGNORE_FILE), "\n" + path + "\n");
    }
    return ignoredAny;
  }

  async exec(command: Command, options?: { remote?: string; run?: Subprocess.RunOptions }) {
    const config = await userConfig.get();
    const info = await this.getRemoteInfo(options?.remote);
    return Ssh.runCommand(info.host, command, {
      cwd: info.directory,
      source: config.syg?.execSource,
    });
  }

  private async moveConfigOut() {
    const insidePath = pathJoin(this.sygGitDir, "config");
    const outsidePath = pathJoin(this.root, CONFIG_FILE);
    if (await isSymbolicLink(insidePath)) {
      logger.debug(`${insidePath} is already a symlink`);
      const linkTarget = absPath(pathJoin(this.sygGitDir, await readlink(insidePath)));
      if (linkTarget !== absPath(outsidePath))
        throw new Syg.InternalError(
          `${insidePath} is symlink to ${linkTarget} and not to ${outsidePath}`,
        );
      return;
    }

    if (await exists(outsidePath)) {
      logger.debug(`${outsidePath} already exists, using it`);
      await unlink(insidePath);
    } else {
      await move(insidePath, outsidePath);
    }
    await createSymlink(pathJoin("..", CONFIG_FILE), insidePath);
  }

  private async;

  private async updateInfoExclude() {
    const excludePath = pathJoin(this.sygGitDir, "info", "exclude");
    const ignorePath = pathJoin(this.root, Syg.IGNORE_FILE);
    let newContent = dedent`
      /${SYG_GIT}
      /${Syg.IGNORE_FILE}
      /${CONFIG_FILE}
    `;
    if (await exists(ignorePath)) {
      const ignorePatterns = await readFile(pathJoin(this.root, Syg.IGNORE_FILE), "utf8");
      newContent += ignorePatterns;
    }
    await writeFile(excludePath, newContent);
  }

  private async verifyRemoteGitVersion(remoteInfo: Syg.RemoteInfo) {
    const version = await (await this.remoteGit(remoteInfo)).version();
    logger.debug("Remote git version: " + version);
    if (semver.lt(version, MIN_GIT_VERSION)) {
      throw new Syg.Error(
        `Remote git version ${version} is too old, need at least ${MIN_GIT_VERSION}`,
      );
    }
  }

  private async remoteGit(remoteInfo: Syg.RemoteInfo) {
    const options: Git.RunOptions = {
      gitBin: pathJoin(remoteInfo.gitBinDir, "git"),
      runner: (await this.remoteSsh(remoteInfo)).runner(),
    };
    return new Git.Instance(options);
  }

  async remoteSsh(remote?: string | Syg.RemoteInfo) {
    const remoteInfo =
      typeof remote === "string" || remote === undefined
        ? await this.getRemoteInfo(remote)
        : remote;
    return new Ssh.Instance(remoteInfo.host, {
      cwd: remoteInfo.directory,
      log: { prefix: `+ [remote] `, logger },
    });
  }

  /** Should be called each time remotes or their parameters are changed */
  private clearCachedRemotes() {
    this.cachedRemotes = undefined;
  }

  private async checkGitDir() {
    try {
      await Git.RevParse.resolveGitDir(this.gitDir);
    } catch (err) {
      if (err instanceof Git.Error.NotAGitDir)
        throw Syg.Error.wrap(err, `No git dir at ${this.gitDir}`);
      throw Syg.Error.wrap(err, "Not in  git repository");
    }
  }

  /**
   * Check if syg git dir exists and is a valid git dir.
   *
   * This function is not called internally for speed purposes.
   */
  async checkSygGitDir() {
    try {
      await Git.RevParse.resolveGitDir(this.sygGitDir);
    } catch (err) {
      if (err instanceof Git.Error.NotAGitDir)
        throw Syg.Error.wrap(err, `Not syg dir at ${this.sygGitDir}`);
      throw Syg.Error.wrap(err, "Not in  git repository");
    }
  }
}

export namespace Syg {
  export class Error extends LoggableError {
    protected static override namePrefix = "Syg.";
  }
  export class InternalError extends Error {
    protected static override namePrefix = "Syg.";
  }
  export class NoDefaultRemote extends Error {
    protected static override namePrefix = "Syg.";
  }

  export interface RemoteInfo {
    name: string;
    host: string;
    directory: string;
    gitBinDir?: string;
    isDefault?: boolean;
  }

  export interface BaseOptions {
    /**
     * Override current directory.
     *
     * Passed to all git commands as `-C`.
     */
    cwd?: string;
    /** Verbose output of git commands */
    gitVerbose?: boolean;
  }

  export interface Options extends BaseOptions {
    /**
     * Work tree root. Must contain `.git` directory.
     *
     * Syg git directory will be created also in this directory. If missing, use
     * {@link Syg.Options.cwd}.
     */
    root?: string;
  }
}

const preReceiveHook = dedent`
  #!/bin/bash

  set -e

  branch=$(git rev-parse --abbrev-ref HEAD)

  if [[ "$branch" != "${BRANCH}" ]]; then
    echo "Unexpected current branch '$branch', forgot to run setup?"
    exit 1
  fi
`;

const pushToCheckoutHook = dedent`
  #!/bin/bash

  git reset --hard --quiet
  git read-tree -u -m HEAD "$1"
`;
