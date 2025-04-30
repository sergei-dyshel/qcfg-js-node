import { dedent } from "@sergei-dyshel/typescript/string";
import { userConfig } from "../lib/config";
import { RootLogger } from "../lib/logging";
import {
  allOclifCommands,
  Args,
  argsInput,
  BaseCommandWithVerbosity,
  command,
  CommandArgs,
  CommandFlags,
  exactlyOne,
  Flags,
  flagsInput,
  mutuallyExclusive,
  OclifHelp,
  restArgs,
  runCli,
} from "../lib/oclif";
import { Syg } from "../lib/syg";
export { allOclifCommands, OclifHelp };

const logger = RootLogger.get();

abstract class RootCommand extends BaseCommandWithVerbosity {
  protected declare flags: CommandFlags<typeof RootCommand>;
  protected declare args: CommandArgs<typeof RootCommand>;
  syg!: Syg;

  static override baseFlags = flagsInput({
    ...BaseCommandWithVerbosity.baseFlags,
    silent: Flags.boolean({
      summary: "Do not fail if not in Syg directory, just silently exit",
      char: "S",
    }),
  });

  public override async init() {
    await super.init();
    try {
      this.syg = await Syg.detect({ gitVerbose: (this.flags.verbose ?? 0) >= 2 });
    } catch (err) {
      if (this.flags.silent && err instanceof Syg.NoSygDir) process.exit();
      throw err;
    }
  }
}

const remotesFlag = flagsInput({
  remotes: Flags.string({
    summary: "Remote names to sync. If omited, sync default remote",
    char: "r",
    multiple: true,
    multipleNonGreedy: true,
  }),
});

@command("init")
export class InitCommand extends BaseCommandWithVerbosity {
  protected declare flags: CommandFlags<typeof InitCommand>;
  protected declare args: CommandArgs<typeof InitCommand>;

  static override summary = "Init syg in current directory";
  static override flags = flagsInput({
    ...Flags.force({ summary: "Recreate syg dir" }),
  });

  override async run() {
    const syg = new Syg();
    await syg.init({ force: this.flags.force });
  }
}

@command(["remote", "add"])
export class RemoteAddCommand extends RootCommand {
  protected declare flags: CommandFlags<typeof RemoteAddCommand>;
  protected declare args: CommandArgs<typeof RemoteAddCommand>;

  static override summary = "Add remote";
  static override description = "Add remote, optionally set it as default ans setup";

  static override flags = flagsInput({
    setDefault: Flags.boolean({
      char: "d",
      summary: "Set remote as default",
    }),
    setup: Flags.boolean({
      char: "s",
      summary: "Setup remote",
      default: true,
      allowNo: true,
    }),
    force: Flags.boolean({
      char: "f",
      summary: "Overwrite remote if it already exists",
    }),
  });

  static override args = argsInput({
    name: Args.string({
      description: "Remote name",
      required: true,
    }),
    host: Args.string({
      description: "Remote hostname",
    }),
    directory: Args.string({
      description: "Remote directory. If empty, use current directory",
    }),
  });

  override async run() {
    await this.syg.addRemote(
      this.args.name,
      // Allow omitting hostname
      this.args.directory ? this.args.host : this.args.name,
      this.args.directory ?? this.args.host,
      {
        setDefault: this.flags.setDefault,
        setup: this.flags.setup,
        force: this.flags.force,
      },
    );
  }
}

@command(["remote", "set-default"])
export class RemoteSetDefaultCommand extends RootCommand {
  protected declare flags: CommandFlags<typeof RemoteSetDefaultCommand>;
  protected declare args: CommandArgs<typeof RemoteSetDefaultCommand>;

  static override summary = "Set remote as default";

  static override args = argsInput({
    name: Args.string({
      description: "Remote name",
      required: true,
    }),
  });

  override async run() {
    await this.syg.setDefaultRemote(this.args.name);
  }
}

@command(["remote", "setup"])
export class RemoteSetupCommand extends RootCommand {
  protected declare flags: CommandFlags<typeof RemoteSetupCommand>;
  protected declare args: CommandArgs<typeof RemoteSetupCommand>;

  static override summary = "Setup remote";

  static override args = argsInput({
    name: Args.string({
      description: "Remote name",
    }),
  });

  override async run() {
    await this.syg.setupRemote(
      this.args.name ?? (await this.syg.getDefaultRemote({ check: true })),
    );
  }
}

@command(["remote", "list"])
export class RemoteListCommand extends RootCommand {
  protected declare flags: CommandFlags<typeof RemoteListCommand>;
  protected declare args: CommandArgs<typeof RemoteListCommand>;

  static override summary = "List remotes";
  static override aliases = ["remote:ls"];

  override async run() {
    const remotes = await this.syg.getRemotes();
    for (const info of Object.values(remotes)) {
      const parts = [info.name, `${info.host}:${info.directory}`];
      if (info.isDefault) parts.push("(default)");
      const line = parts.join("\t");
      console.log(line);
    }
  }
}

@command(["remote", "rename"])
export class RemoteRenameCommand extends RootCommand {
  protected declare flags: CommandFlags<typeof RemoteRenameCommand>;
  protected declare args: CommandArgs<typeof RemoteRenameCommand>;

  static override summary = "Rename remote";
  static override description = "Rename remote and preserve default flag";

  static override args = argsInput({
    oldName: Args.string({
      description: "Old remote name",
      required: true,
    }),
    newName: Args.string({
      description: "New remote name",
      required: true,
    }),
  });

  override async run() {
    await this.syg.renameRemote(this.args.oldName, this.args.newName);
  }
}

@command(["remote", "dump"])
export class RemoteDumpCommand extends RootCommand {
  protected declare flags: CommandFlags<typeof RemoteDumpCommand>;
  protected declare args: CommandArgs<typeof RemoteDumpCommand>;

  static override aliases = ["remote"];
  static override summary = "Dump information about remote";

  static override flags = flagsInput({
    ...mutuallyExclusive({
      remote: Flags.string({
        summary: "Remote name",
        description: "If not given, dump default remote",
        char: "r",
        exclusive: ["all"],
      }),
      all: Flags.boolean({
        summary: "Dump all remotes",
        char: "a",
        exclusive: ["remote"],
      }),
    }),
    ...exactlyOne(
      flagsInput({
        host: Flags.boolean({
          summary: "Dump remote hostname",
          char: "H",
          exactlyOne: ["host", "url", "directory"],
        }),
        url: Flags.boolean({
          summary: "Dump remote URL",
          char: "U",
          exactlyOne: ["host", "url", "directory"],
        }),
        directory: Flags.boolean({
          summary: "Dump remote directory",
          char: "D",
          exactlyOne: ["host", "url", "directory"],
        }),
      }),
    ),
  });

  override async run() {
    const remotes = this.flags.all
      ? Object.values(await this.syg.getRemotes())
      : [await this.syg.getRemoteInfo(this.flags.remote)];
    for (const remote of remotes) {
      if (this.flags.host) console.log(remote.host);
      if (this.flags.url) console.log(remote.sshPath);
      if (this.flags.directory) console.log(remote.directory);
    }
  }
}

@command("sync")
export class SyncCommand extends RootCommand {
  protected declare flags: CommandFlags<typeof SyncCommand>;
  protected declare args: CommandArgs<typeof SyncCommand>;

  static override summary = "Sync remote(s)";

  static override flags = flagsInput({
    ...remotesFlag,
  });

  static override args = argsInput({
    path: Args.string({
      description: "Paths to sync",
    }),
  });

  override async run() {
    const updated = await this.syg.sync({ remotes: this.flags.remotes, pathspecs: this.argv });
    if (!updated) logger.warn("No remotes were updated");
  }
}

@command("ignore")
export class IgnoreCommand extends RootCommand {
  protected declare flags: CommandFlags<typeof IgnoreCommand>;
  protected declare args: CommandArgs<typeof IgnoreCommand>;

  static override summary = "Ignore file(s)";
  static override description = dedent`
    Remote file from syg sync set, i.e. stop synchronizing it with sync command.
    Adds path(s) to ${Syg.IGNORE_FILE} file.
    `;
  static override strict = false;

  static override args = argsInput({
    paths: Args.string({
      description: "Path(s) to ignore",
    }),
  });

  override async run() {
    await this.syg.ignore(this.argv);
  }
}

@command("git")
export class GitCommand extends RootCommand {
  protected declare flags: CommandFlags<typeof GitCommand>;
  protected declare args: CommandArgs<typeof GitCommand>;

  static override summary = "Run arbitrary git command in syg git repo";
  static override description = dedent`
    Properly adds --git-dir and --work-tree options to command.
  `;
  static override args = restArgs();

  override async run() {
    const result = await this.syg.sygGit.run(this.argv, { log: { shouldLog: true } });
    process.exit(result.exitCode ?? 0);
  }
}

@command("tool")
export class ToolCommand extends RootCommand {
  protected declare flags: CommandFlags<typeof ToolCommand>;
  protected declare args: CommandArgs<typeof ToolCommand>;

  static override summary = "Run arbitrary git related tool in syg git repo";
  static override description = dedent`
    Properly sets environment variables GIT_DIR and GIT_WORK_TREE.
  `;
  static override args = restArgs();

  override async run() {
    const result = await this.syg.sygGit.runTool(this.argv);
    process.exit(result.exitCode ?? 0);
  }
}

@command("exec")
export class ExecCommand extends RootCommand {
  protected declare flags: CommandFlags<typeof ExecCommand>;
  protected declare args: CommandArgs<typeof ExecCommand>;

  static override summary = "Execute shell command on remote";

  static override args = restArgs();
  static override flags = flagsInput({
    remote: Flags.string({
      summary: "Remote name",
      char: "r",
    }),
  });

  override async run() {
    const config = await userConfig.get();
    const ssh = await this.syg.remoteSsh(this.flags.remote);
    const result = await ssh.run(this.argv, { source: config.syg?.execSource });
    process.exit(result.exitCode ?? 0);
  }
}

@command("rsync")
export class RsyncCommand extends RootCommand {
  protected declare flags: CommandFlags<typeof RsyncCommand>;
  protected declare args: CommandArgs<typeof RsyncCommand>;

  static override strict = false;
  static override summary = "Upload/download files to remote using rsync";
  static override args = argsInput({
    files: Args.string({
      summary: "File names to upload/download",
    }),
  });

  static override flags = flagsInput({
    ...remotesFlag,
    update: Flags.boolean({
      char: "u",
      summary: "Only update old files",
    }),
    existing: Flags.boolean({
      char: "E",
      summary: "Only update existing files",
    }),
    download: Flags.boolean({
      char: "d",
      summary: "Download files (by default uploads)",
    }),
    copyLinks: Flags.boolean({
      char: "L",
      summary: "Followsymlinks",
    }),
    include: Flags.string({
      char: "i",
      summary: "Include files matching pattern",
      multiple: true,
      multipleNonGreedy: true,
    }),
    exclude: Flags.string({
      char: "e",
      summary: "Exclude files matching pattern",
      multiple: true,
      multipleNonGreedy: true,
    }),
    src: Flags.string({
      char: "S",
      summary: "Source directory relative to remote root",
    }),
    dst: Flags.string({
      char: "D",
      summary: "Source directory relative to remote root",
    }),
    names: Flags.boolean({
      char: "n",
      summary: "Print names of updated files",
    }),
    progress: Flags.boolean({
      char: "p",
      summary: "Show progress during transfer",
    }),
    stats: Flags.boolean({
      char: "s",
      summary: "Show stats in the end of transfer",
    }),
  });

  override async run() {
    await this.syg.rsync({ ...this.flags, verbose: false, files: this.argv });
  }
}

void runCli(__filename, __dirname, {
  description: "Syg, synced git",
  defaultCommand: SyncCommand,
  topics: {
    remote: {
      description: "Operations with remotes",
    },
  },
});
