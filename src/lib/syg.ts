/** Remote branch */
// const BRANCH = "syg";

import { assertNotNull, LoggableError } from "@sergei-dyshel/typescript/error";
import { mapValuesAsync, objectEntries } from "@sergei-dyshel/typescript/object";
import { dedent } from "@sergei-dyshel/typescript/string";
import { canBeUndefined } from "@sergei-dyshel/typescript/types";
import { createSymlink, mkdir, move, rm } from "fs-extra";
import { readFile, readlink, unlink, writeFile } from "fs/promises";
import { dirname, isAbsolute } from "path";
import * as semver from "semver";
import { Ssh } from ".";
import { exists, isSymbolicLink } from "./filesystem";
import { Git } from "./git";
import { ModuleLogger } from "./logging";
import { absPath, pathJoin } from "./path";

/**
 * Store git config file that is used for syg config too outside of syg git dir this way it can be
 * backed up without including whole syg git dir
 */
const CONFIG_FILE = ".syg.config";

const DEFAULT_REMOTE_KEY = "syg.defaultRemote";

/**
 * File with patterns to ignore when syncing
 */
const IGNORE_FILE = ".syg.gitignore";

/** Max commits in git log before squashing */
// const MAX_GIT_LOG_LEN = 50;

const MIN_GIT_VERSION = "2.40.1";

// const ADD_PATHSPEC = ".syg.add";

const SYG_GIT = ".syg.git";

const BRANCH = "syg";

/** Commit message used for commit with added files */
const ADD_COMMIT_MSG = "+ syg";

const logger = new ModuleLogger({ name: "syg" });

export interface SygOptions {
  /** Override current directory */
  cwd?: string;
  /** Initialize syg in git root */
  init?: boolean;
  force?: boolean;
  /** Verbose output of git commands */
  gitVerbose?: boolean;
}

export class Syg {
  private readonly sygGitPath: string;
  private readonly git: Git.Instance;

  readonly sygGit: Git.Instance;

  private cachedRemotes: Record<string, Syg.RemoteInfo> | undefined;

  constructor(
    readonly cwd: string | undefined,
    readonly gitVerbose: boolean,
  ) {
    this.sygGitPath = pathJoin(cwd, SYG_GIT);
    this.sygGit = new Git.Instance({
      gitDir: this.sygGitPath,
      workTree: cwd ?? ".",
      log: { prefix: "+ [syg.git] " },
    });
    this.git = new Git.Instance({
      gitDir: pathJoin(cwd, Git.DEFAULT_GIT_DIR),
      workTree: cwd ?? ".",
    });
  }

  async init(options?: {
    /** Force initialize (if init = true) */
    force?: boolean;
  }) {
    if (!(await Git.isRepoRoot({ cwd: this.cwd }))) throw new Syg.Error("Not in  git repository");
    let sygGitExists = await exists(this.sygGitPath);
    if (options?.force) {
      if (sygGitExists) {
        logger.debug("Removing existing syg git dir");
        await rm(this.sygGitPath, { recursive: true });
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
    await mkdir(pathJoin(this.sygGitPath, "info"), { recursive: true });
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

  async setRemoteGitBinDir(remote: string, gitBin: string) {
    await this.sygGit.setConfigRemote(remote, "receivepack", pathJoin(gitBin, "git-receive-pack"), {
      local: true,
    });
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

  private async getRemote(
    remote: string,
    options?: { noCache?: boolean; notRequired?: false | undefined },
  ): Promise<Syg.RemoteInfo>;
  private async getRemote(
    remote: string,
    options?: { noCache?: boolean; notRequired: true },
  ): Promise<Syg.RemoteInfo | undefined>;
  private async getRemote(remote: string, options?: { noCache?: boolean; notRequired?: boolean }) {
    if (options?.noCache ?? this.cachedRemotes === undefined)
      this.cachedRemotes = await this.getRemotes();
    const remoteInfo = this.cachedRemotes[remote] as Syg.RemoteInfo | undefined;
    if (!options?.notRequired && !remoteInfo) throw new Syg.Error(`Remote ${remote} not found`);
    return remoteInfo;
  }

  async setupRemote(remote: string) {
    const remoteInfo = await this.getRemote(remote);
    await this.verifyRemoteGitVersion(remoteInfo);
    const remoteGit = this.remoteGit(remoteInfo);
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
    const ssh = this.remoteSsh(remoteInfo);
    await ssh.writeFile(".git/hooks/pre-receive", preReceiveHook, { mode: 0o755 });
    await ssh.writeFile(".git/hooks/push-to-checkout", pushToCheckoutHook, { mode: 0o755 });
  }

  async getDefaultRemote(options?: { check?: false }): Promise<string | undefined>;
  async getDefaultRemote(options: { check: true }): Promise<string>;
  async getDefaultRemote(options?: { check?: boolean }) {
    let remote = await this.sygGit.getConfigCustom(DEFAULT_REMOTE_KEY, { local: true });
    // getRemotes should not call recursively to itself via getDefaultRemote
    const remotes = await this.getRemotes({ noDefault: true });
    if (remote && !canBeUndefined(remotes[remote])) {
      logger.error(`Default remote ${remote} is not a remote`);
      await this.unsetDefaultRemote();
      remote = undefined;
    }
    if (options?.check && !remote) throw new Syg.NoDefaultRemote("Default remote is not set");
    return remote;
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
    const old = await this.getRemote(oldName);
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
    // make syg comit history as local repo
    const head = await this.git.revParseHead();
    logger.debug(`Local head: ${head}`);
    if (!(await this.sygGit.commitExists(head)))
      await this.sygGit.fetch([this.cwd ?? ".", head], { quiet: !this.gitVerbose });

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
    const remotes = options?.remotes ?? [await this.getDefaultRemote({ check: true })];
    for (const remote of remotes) {
      logger.info(`Syncing ${remote}`);
      const remoteHead = await this.sygGit.revParse(`remotes/${remote}/${BRANCH}`, {
        verify: true,
        quiet: true,
      });
      if (!remoteHead) {
        logger.debug("First sync, fetching remote");
        await this.sygGit.fetch([remote, BRANCH], { quiet: !this.gitVerbose });
      }
      await this.sygGit.diffRaw(`${remote}/${BRANCH}`, {
        noPager: true,
        cached: true,
        stat: true,
      });
      if (addCommit === remoteHead) {
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

  private async moveConfigOut() {
    const insidePath = pathJoin(this.sygGitPath, "config");
    const outsidePath = pathJoin(this.cwd, CONFIG_FILE);
    if (await isSymbolicLink(insidePath)) {
      logger.debug(`${insidePath} is already a symlink`);
      const linkTarget = absPath(pathJoin(this.sygGitPath, await readlink(insidePath)));
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

  private async updateInfoExclude() {
    const excludePath = pathJoin(this.sygGitPath, "info", "exclude");
    const ignorePath = pathJoin(this.cwd, IGNORE_FILE);
    let newContent = dedent`
      /${SYG_GIT}
      /${IGNORE_FILE}
      /${CONFIG_FILE}
    `;
    if (await exists(ignorePath)) {
      const ignorePatterns = await readFile(pathJoin(this.cwd, IGNORE_FILE), "utf8");
      newContent += ignorePatterns;
    }
    await writeFile(excludePath, newContent);
  }

  private async verifyRemoteGitVersion(remoteInfo: Syg.RemoteInfo) {
    const version = await this.remoteGit(remoteInfo).version();
    logger.debug("Remote git version: " + version);
    if (semver.lt(version, MIN_GIT_VERSION)) {
      throw new Syg.Error(
        `Remote git version ${version} is too old, need at least ${MIN_GIT_VERSION}`,
      );
    }
  }

  private remoteGit(remoteInfo: Syg.RemoteInfo) {
    const options: Git.RunOptions = {
      gitBin: pathJoin(remoteInfo.gitBinDir, "git"),
      runner: this.remoteSsh(remoteInfo).runner(),
    };
    return new Git.Instance(options);
  }

  private remoteSsh(remoteInfo: Syg.RemoteInfo) {
    return new Ssh.Instance(remoteInfo.host, {
      cwd: remoteInfo.directory,
      log: { prefix: `+ [remote] `, logger },
    });
  }

  /** Should be called each time remotes or their parameters are changed */
  private clearCachedRemotes() {
    this.cachedRemotes = undefined;
  }
}

export namespace Syg {
  export class Error extends LoggableError {}
  export class InternalError extends Error {}
  export class NoDefaultRemote extends Error {}

  export interface RemoteInfo {
    name: string;
    host: string;
    directory: string;
    gitBinDir?: string;
    isDefault?: boolean;
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
