import "reflect-metadata";

import { Args, Command, execute, Flags, type Interfaces } from "@oclif/core";
import { Hook, type Hooks } from "@oclif/core/hooks";
import type { PJSON } from "@oclif/core/interfaces";
import * as PluginAutoComplete from "@sergei-dyshel/oclif-plugin-autocomplete-cjs";
import { assert } from "@sergei-dyshel/typescript/error";
import { DefaultMap } from "@sergei-dyshel/typescript/map";
import { extendsType } from "@sergei-dyshel/typescript/types";
import { configureLogging, type LogHandlerOptions, LogLevel, LogLevels } from "./logging";
import { basename } from "./path";

export { Args, Command, Flags, Hook };

/**
 * Provides basic machinery for writing Oclif commands. You should always subclass this class and
 * not {@link Command} directly.
 *
 * Should be use as follows;
 *
 * ```ts
 * class MyCommand extends BaseCommand<typeof MyCommand> {
 *   override run() {}
 * }
 * ```
 */
export abstract class BaseCommand extends Command {
  static override baseFlags = {};

  protected args!: CommandArgs<typeof BaseCommand>;
  protected flags!: CommandFlags<typeof BaseCommand>;
  protected parsed_argv!: string[];

  public override async init(): Promise<void> {
    await super.init();
    const { args, flags, argv } = await this.parse({
      flags: this.ctor.flags,
      baseFlags: (super.ctor as typeof BaseCommand).baseFlags,
      enableJsonFlag: this.ctor.enableJsonFlag,
      args: this.ctor.args,
      strict: this.ctor.strict,
    });
    this.flags = flags;
    this.args = args;
    this.parsed_argv = argv as string[];
  }

  abstract override run(): Promise<void>;
}

/**
 * Helper function to be used for {@link Command.flags} property to ensure proper type..
 */
export const extendsFlagsInput = extendsType<FlagsInput>();
export const extendsArgsInput = extendsType<ArgsInput>();

export const verbosityFlags = extendsFlagsInput({
  verbose: Flags.boolean({
    char: "v",
    summary: "Verbosity level. Can be used multiple times.",
    default: false,
  }),
});

export abstract class BaseCommandWithVerbosity extends BaseCommand {
  static override baseFlags = {
    ...super.baseFlags,
    ...verbosityFlags,
  } as const;

  protected declare flags: CommandFlags<typeof BaseCommandWithVerbosity>;

  protected verboseBaseLogLevel = LogLevel.WARNING;
  protected verbosity = 0;

  /** Use to override logging configuration in subclasses */
  protected logHandlerOptions: Omit<LogHandlerOptions, "level"> | undefined = {};

  public override async init(): Promise<void> {
    await super.init();

    if (this.flags.verbose) {
      for (const arg of this.argv) {
        if (arg === "--verbose") this.verbosity += 1;
        if (/^-v+$/.test(arg)) this.verbosity += arg.length - 1;
      }
    }

    configureLogging({
      handler: {
        ...this.logHandlerOptions,
        level: LogLevels.addVerbosity(this.verboseBaseLogLevel, this.verbosity),
      },
    });
  }
}

/**
 * Use this type of when you want to assign parsed flags to variable.
 *
 * T - current command class, B - inherited command class
 */
export type CommandFlags<T extends typeof Command> = Interfaces.InferredFlags<
  T["baseFlags"] & T["flags"]
>;

/**
 * Use this type of when you want to assign parsed flags to variable.
 */
export type CommandArgs<T extends typeof Command> = Interfaces.InferredArgs<T["args"]>;

type FlagsInput = (typeof Command)["flags"];
type ArgsInput = (typeof Command)["args"];

/**
 * Wrapper of {@link execute}. Feeds proper package.json mock so that bundled executable can run on
 * its own.
 */
export function runCli(
  filename: string,
  dirname: string,
  options?: {
    /** Default command to run when no arguments are given */
    defaultCommand?: string;
    /** Description help for CLI */
    description?: string;
  },
) {
  for (const autocompCmd of Object.values(PluginAutoComplete.commands)) {
    autocompCmd.hidden = true;
  }

  const binName =
    filename.startsWith("index.") || filename.startsWith("main.")
      ? basename(dirname)
      : basename(filename);

  const hooks: PJSON["oclif"]["hooks"] = Object.fromEntries(
    [...allHooks.entries()].map(([type, names]) => [
      type,
      names.map((name) => ({
        target: filename,
        identifier: name,
      })),
    ]),
  );

  let description = options?.description ?? "";

  if (options?.defaultCommand) {
    assert(
      options.defaultCommand in allOclifCommands,
      `Command ${options.defaultCommand} not found in list or registered commands`,
    );
    description += `\n\nIf not command or arguments given, will run "${options.defaultCommand}" command.`;
    if (process.argv.length === 2) process.argv.push(options.defaultCommand);
  }

  return execute({
    dir: dirname,
    loadOptions: {
      root: dirname,
      pjson: {
        name: binName,
        version: "1.0",
        oclif: {
          bin: binName,
          description,
          commands: {
            strategy: "explicit",
            target: filename,
            identifier: Object.keys({ allOclifCommands })[0],
          },
          topicSeparator: " ",
          helpOptions: {
            flagSortOrder: "none",
            maxWidth: 80,
          },
          hooks,
        },
      },
    },
  });
}

export const allOclifCommands: Record<string, any> = {
  ...PluginAutoComplete.commands,
};

/**
 * Class decorator for adding Oclif command.
 *
 * Must export {@link allOclifCommands} in main file, e.g.:
 *
 * ```ts
 * export { allOclifCommands } from "@sergei-dyshel/node/oclif";
 * ```
 */
export function command(
  name: string,
  options?: {
    /** Parent command name */
    parent?: typeof Command;
  },
) {
  return (constructor: object) => {
    const fullName = options?.parent
      ? (Reflect.getMetadata("oclif:command-name", options.parent) as string) + ":" + name
      : name;
    Reflect.defineMetadata("oclif:command-name", fullName, constructor);
    allOclifCommands[fullName] = constructor;
  };
}

const allHooks = new DefaultMap<string | number, string[]>(() => []);

/**
 * Register Oclif hook (see https://oclif.io/docs/hooks/).
 *
 * Each hook must be defined as export (or reexported in main file) function with unique name and
 * then registered. Example:
 *
 * ```ts
 * export const INIT_HOOK: Hook<"init"> = () => {
 * ...
 * };
 *
 * addHook("init", INIT_HOOK);
 * ```
 */
export function addHook<T extends keyof Hooks>(type: T, hook: Hook<T>) {
  const name = hook.name;
  allHooks.get(type).push(name);
}
