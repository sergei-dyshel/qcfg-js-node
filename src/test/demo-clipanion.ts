import { Builtins, Cli, Command, Option } from "clipanion";
import { basename } from "path";
import * as t from "typanion";

class MyCommand extends Command {
  static override usage = Command.Usage({
    description: "First subcommand",
  });

  opt = Option.String("-o,--opt", { description: "Optional string option" });
  flag = Option.Boolean("-f,--flag", { description: "Optional boolean flag" });

  protected unrelatedProperty = 1;

  // eslint-disable-next-line @typescript-eslint/require-await
  override async execute() {
    console.log(`opt ${this.opt} flag ${this.flag}`);
  }
}

class FirstSubcommand extends MyCommand {
  static override paths = [["first"]];
  pos = Option.String({ name: "POSITIONAL", required: false });

  override async execute() {
    await super.execute();
    console.log(`pos ${this.pos}`);
  }
}

class SecondSubcommand extends MyCommand {
  static override paths = [["second"]];

  static override usage = Command.Usage({
    description: "Second subcommand",
  });

  pos = Option.String({ name: "POSITIONAL", required: false });
  choice = Option.String("--choice", "c", {
    description: "Choice option",
    validator: t.isEnum(["a", "b", "c"] as const),
  });

  override async execute() {
    await super.execute();
    console.log(`pos ${this.pos} choice ${this.choice}`);
  }
}

const [_node, app, ...args] = process.argv;

const cli = new Cli({
  binaryVersion: basename(app),
  binaryLabel: "My CLI",
});

cli.register(FirstSubcommand);
cli.register(SecondSubcommand);
cli.register(Builtins.HelpCommand);

void cli.runExit(args);
