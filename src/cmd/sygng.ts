import { dedent } from "@sergei-dyshel/typescript/string";
import { RootLogger } from "../lib/logging";
import {
  allOclifCommands,
  Args,
  BaseCommandWithVerbosity,
  booleanFlag,
  command,
  CommandArgs,
  CommandFlags,
  CommonFlags,
  extendsArgsInput,
  extendsFlagsInput,
  Flags,
  hiddenVerbosityFlags,
  OclifHelp,
  runCli,
} from "../lib/oclif";
import { Syg } from "../lib/syg";
export { allOclifCommands, OclifHelp };

const logger = RootLogger.get();

abstract class RootCommand extends BaseCommandWithVerbosity {
  syg!: Syg;

  public override async init() {
    await super.init();
    this.syg = await Syg.detect({ gitVerbose: this.verbosity >= 2 });
  }
}

@command("init")
export class InitCommand extends RootCommand {
  static override summary = "Init syg in current directory";
  static override flags = extendsFlagsInput({
    ...CommonFlags.force({ summary: "Recreate syg dir" }),
  });
  protected declare flags: CommandFlags<typeof InitCommand>;

  override async run() {
    await this.syg.init({ force: this.flags.force });
  }
}

@command(["remote", "add"])
export class RemoteAddCommand extends RootCommand {
  static override summary = "Add remote";
  static override description = "Add remote, optionally set it as default ans setup";

  static override flags = extendsFlagsInput({
    setDefault: booleanFlag({
      char: "d",
      summary: "Set remote as default",
    }),
    setup: booleanFlag({
      char: "s",
      summary: "Setup remote",
    }),
  });

  static override args = extendsArgsInput({
    name: Args.string({
      description: "Remote name",
      required: true,
    }),
    host: Args.string({
      description: "Remote hostname",
      required: true,
    }),
    directory: Args.string({
      description: "Remote directory. If empty, use current directory",
    }),
  });

  protected declare flags: CommandFlags<typeof RemoteAddCommand>;
  protected declare args: CommandArgs<typeof RemoteAddCommand>;

  override async run() {
    await this.syg.addRemote(this.args.name, this.args.host, this.args.directory, {
      setDefault: this.flags.setDefault,
      setup: this.flags.setup,
    });
  }
}

@command(["remote", "set-default"])
export class RemoteSetDefaultCommand extends RootCommand {
  static override summary = "Set remote as default";

  static override args = extendsArgsInput({
    name: Args.string({
      description: "Remote name",
      required: true,
    }),
  });

  protected declare args: CommandArgs<typeof RemoteSetDefaultCommand>;

  override async run() {
    await this.syg.setDefaultRemote(this.args.name);
  }
}

@command(["remote", "setup"])
export class RemoteSetupCommand extends RootCommand {
  static override summary = "Setup remote";

  static override args = extendsArgsInput({
    name: Args.string({
      description: "Remote name",
    }),
  });

  protected declare args: CommandArgs<typeof RemoteSetupCommand>;

  override async run() {
    await this.syg.setupRemote(
      this.args.name ?? (await this.syg.getDefaultRemote({ check: true })),
    );
  }
}

@command(["remote", "list"])
export class RemoteListCommand extends RootCommand {
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
  static override summary = "Rename remote";
  static override description = "Rename remote and preserve default flag";

  static override args = extendsArgsInput({
    oldName: Args.string({
      description: "Old remote name",
      required: true,
    }),
    newName: Args.string({
      description: "New remote name",
      required: true,
    }),
  });

  protected declare args: CommandArgs<typeof RemoteRenameCommand>;

  override async run() {
    await this.syg.renameRemote(this.args.oldName, this.args.newName);
  }
}

@command(["remote", "dump"])
export class RemoteDumpCommand extends RootCommand {
  protected declare flags: CommandFlags<typeof RemoteDumpCommand>;

  static override aliases = ["remote"];
  static override summary = "Dump information about remote";

  static override flags = extendsFlagsInput({
    remote: Flags.string({
      summary: "Remote name",
      description: "If not given, dump default remote",
      char: "r",
    }),
    host: booleanFlag({
      summary: "Dump remote hostname",
      char: "H",
      exactlyOne: ["host", "url", "directory"],
    }),
    url: booleanFlag({
      summary: "Dump remote URL",
      char: "U",
      exactlyOne: ["host", "url", "directory"],
    }),
    directory: booleanFlag({
      summary: "Dump remote directory",
      char: "D",
      exactlyOne: ["host", "url", "directory"],
    }),
  });

  override async run() {
    return Promise.resolve();
  }
}

@command("sync")
export class SyncCommand extends RootCommand {
  protected declare flags: CommandFlags<typeof SyncCommand>;
  protected declare args: CommandArgs<typeof SyncCommand>;

  static override summary = "Sync remote(s)";

  static override strict = true;

  static override flags = extendsFlagsInput({
    remote: Flags.string({
      summary: "Remote names to sync. If omited, sync default remote",
      char: "r",
      multiple: true,
    }),
  });

  static override args = extendsArgsInput({
    path: Args.string({
      description: "Paths to sync",
    }),
  });

  override async run() {
    const updated = await this.syg.sync({ remotes: this.flags.remote, pathspecs: this.argv });
    if (!updated) logger.warn("No remotes were updated");
  }
}

@command("git")
export class GitCommand extends RootCommand {
  static override summary = "Run arbitrary git command in syg git repo";
  static override description = dedent`
    Properly adds --git-dir and --work-tree options to command.

    If first argument is -v, -vv, etc. then it will determine verbosity of syg and not of the git command.
  `;
  protected override wrapper = true;
  static override baseFlags = hiddenVerbosityFlags;

  static override args = extendsArgsInput({
    command: Args.string({
      description: "Git command to run",
    }),
  });

  override async run() {
    if (this.argv.length > 0 && this.argv[0].startsWith("-v")) {
      this.parseVerbosity(this.argv.slice(0, 1));
      this.argv.splice(0, 1);
    }
    this.configureLogging();
    const result = await this.syg.sygGit.run(this.argv);
    process.exit(result.exitCode ?? 0);
  }
}

@command("tool")
export class ToolCommand extends RootCommand {
  static override summary = "Run arbitrary git related tool in syg git repo";
  static override description = dedent`
    Properly sets environment variables GIT_DIR and GIT_WORK_TREE.

    If first argument is -v, -vv, etc. then it will determine verbosity of syg.
  `;
  protected override wrapper = true;
  static override baseFlags = hiddenVerbosityFlags;

  static override args = extendsArgsInput({
    command: Args.string({
      description: "Command to run",
    }),
  });

  override async run() {
    if (this.argv.length > 0 && this.argv[0].startsWith("-v")) {
      this.parseVerbosity(this.argv.slice(0, 1));
      this.argv.splice(0, 1);
    }
    this.configureLogging();
    const result = await this.syg.sygGit.runTool(this.argv);
    process.exit(result.exitCode ?? 0);
  }
}

void runCli(__filename, __dirname, {
  description: "Syg, synced git",
  development: true,
  defaultCommand: SyncCommand,
  topics: {
    remote: {
      description: "Operations with remotes",
    },
  },
});
