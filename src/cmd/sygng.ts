import {
  allOclifCommands,
  BaseCommandWithVerbosity,
  command,
  CommandFlags,
  CommonFlags,
  extendsFlagsInput,
  OclifHelp,
} from "../lib/oclif";
import { Syg } from "../lib/syg";
export { allOclifCommands, OclifHelp };

abstract class RootCommand extends BaseCommandWithVerbosity {
  syg!: Syg;

  public override async init() {
    await super.init();
    this.syg = new Syg(undefined /* cwd */, this.verbosity >= 2);
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
