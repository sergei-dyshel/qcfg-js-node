/**
 * @file Wrapper for oclif framework.
 *
 *   To work properly, you ust export {@link allOclifCommands} and {@link OclifHelp } in main file,
 *   e.g.:
 *
 *   ```ts
 *   export { allOclifCommands, OclifHelp } from "@sergei-dyshel/node/oclif";
 *   ```
 */

import { canResolveLocalOrGlobal } from "./require";
if (!canResolveLocalOrGlobal("typescript")) {
  console.error(
    'Oclif-based CLIs need "typescript" package to be installed globally.\nPlease run "npm install -g typescript"',
  );
  process.exit(1);
}

import { Args, Command, CommandHelp, execute, Flags, Help, type Interfaces } from "@oclif/core";
import { Hook, type Hooks } from "@oclif/core/hooks";
import type { BooleanFlag, OclifConfiguration, PJSON } from "@oclif/core/interfaces";
import * as PluginAutoComplete from "@sergei-dyshel/oclif-plugin-autocomplete-cjs";
import { assert, assertNotNull } from "@sergei-dyshel/typescript/error";
import { DefaultMap } from "@sergei-dyshel/typescript/map";
import { mapKeys } from "@sergei-dyshel/typescript/object";
import { camelCase, kebabCase } from "@sergei-dyshel/typescript/string";
import { canBeUndefined, extendsType } from "@sergei-dyshel/typescript/types";
import "reflect-metadata";
import {
  configureLogging,
  logError,
  loggingConfigured,
  type LogHandlerOptions,
  LogLevel,
  LogLevels,
} from "./logging";
import { basename } from "./path";

export { Args, Command, Flags, Hook };

/**
 * A better version of {@link Flags.boolean} that upon parsing will be inferred as `boolean` or
 * `boolean | undefined` (depending on presense of default value).
 *
 * {@link Flags.boolean} will be inferred as `any`.
 */
export function booleanFlag(
  options: Partial<BooleanFlag<boolean>> & { default: boolean },
): BooleanFlag<boolean>;
export function booleanFlag(
  options?: Partial<BooleanFlag<boolean>>,
): BooleanFlag<boolean | undefined>;
export function booleanFlag(options?: Partial<BooleanFlag<boolean>>) {
  return Flags.boolean(options);
}

/**
 * Common flags used in many CLI tools. Some of flag fields are pre-filled (but overridable).
 */
export namespace CommonFlags {
  export function force(options: Partial<BooleanFlag<boolean>>) {
    return extendsFlagsInput({ force: booleanFlag({ char: "f", ...options }) });
  }
}
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

  static override strict = false;
  /**
   * Indicates that this command is wrapper for another command.
   *
   * In this case flags and args will not be parsed and can be accessed as is via
   * {@link Command.argv}.
   */
  protected wrapper = false;

  protected args!: CommandArgs<typeof BaseCommand>;
  protected flags!: CommandFlags<typeof BaseCommand>;

  public override async init(): Promise<void> {
    await super.init();

    if (this.wrapper) {
      assert(canBeUndefined(this.ctor.flags) === undefined, "Wrapper command can not have flags");
      return;
    }

    const toKebabCase = (key: string) => kebabCase(key);
    const toCamelCase = (key: string) => camelCase(key);

    const { args, flags } = await this.parse({
      flags: mapKeys(canBeUndefined(this.ctor.flags) ?? {}, toKebabCase),
      baseFlags: mapKeys(
        canBeUndefined((super.ctor as typeof BaseCommand).baseFlags) ?? {},
        toKebabCase,
      ),
      enableJsonFlag: this.ctor.enableJsonFlag,
      args: mapKeys(canBeUndefined(this.ctor.args) ?? {}, toKebabCase),
      strict: this.ctor.strict,
    });
    this.flags = mapKeys(flags, toCamelCase) as typeof this.flags;
    this.args = mapKeys(args, toCamelCase) as typeof this.args;
  }

  abstract override run(): Promise<void>;
}

/**
 * Helper function to be used for {@link Command.flags} property to ensure proper type..
 */
export const extendsFlagsInput = extendsType<FlagsInput>();
export const extendsArgsInput = extendsType<ArgsInput>();

const verbosityFlags = extendsFlagsInput({
  verbose: Flags.boolean({
    char: "v",
    summary: "Verbosity level. Can be used multiple times.",
    default: false,
  }),
});

/**
 * To be used in wrapper commands to hide --verbose flag in usage.
 *
 * Usage:
 *
 * ```ts
 * static override baseFlags = { hiddenVerbosityFlags };
 * ```
 */
export const hiddenVerbosityFlags = extendsFlagsInput({
  verbose: Flags.boolean({
    hidden: true,
  }),
});

export abstract class BaseCommandWithVerbosity extends BaseCommand {
  static override baseFlags = {
    ...super.baseFlags,
    ...verbosityFlags,
  } as const;

  protected declare flags: CommandFlags<typeof BaseCommandWithVerbosity>;

  /** Log level when no verbose flags given. */
  protected verboseBaseLogLevel = LogLevel.WARNING;

  /** Number of times --verbose/-v is specified. */
  protected verbosity = 0;

  /** Use to override logging configuration in subclasses */
  protected logHandlerOptions: Omit<LogHandlerOptions, "level"> | undefined = {};

  /**
   * Parse verbosity flags.
   *
   * Should be used by wrapper commands (see {@link BaseCommand.wrapper}).
   */
  protected parseVerbosity(argv = this.argv) {
    for (const arg of argv) {
      if (arg === "--verbose") this.verbosity += 1;
      if (/^-v+$/.test(arg)) this.verbosity += arg.length - 1;
    }
  }

  protected configureLogging() {
    configureLogging({
      handler: {
        ...this.logHandlerOptions,
        level: LogLevels.addVerbosity(this.verboseBaseLogLevel, this.verbosity),
      },
    });
  }
  /** Must call parent method when overriding */
  public override async init() {
    await super.init();

    // wrapper commands would need to configure verbosity themselves
    if (this.wrapper) return;

    if (this.flags.verbose) {
      this.parseVerbosity();
    }

    configureLogging({
      handler: {
        ...this.logHandlerOptions,
        level: LogLevels.addVerbosity(this.verboseBaseLogLevel, this.verbosity),
      },
    });
  }

  protected override catch(err: Interfaces.CommandError) {
    // If error happened before all arguments are parsed (e.g. wrong flags)
    if (!loggingConfigured()) return super.catch(err);

    logError(err, {
      hideName: this.verbosity == 0,
      hideStack: this.verbosity == 0,
    });
    this.exit(err.exitCode ?? 1);
    return Promise.resolve();
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
    defaultCommand?: string | typeof Command;
    /** Description help for CLI */
    description?: string;
    topics?: OclifConfiguration["topics"];
    /**
     * Set development mode of Oclif.
     *
     * Particularly enables printing stacktraces when parsing errors occur.
     */
    development?: boolean;
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
    const defaultCommand =
      typeof options.defaultCommand === "string"
        ? options.defaultCommand
        : commandName(options.defaultCommand);
    assert(
      defaultCommand in allOclifCommands,
      `Command ${defaultCommand} not found in list or registered commands`,
    );
    description += `\n\nIf not command or arguments given, will run "${defaultCommand}" command.`;
    if (process.argv.length === 2) process.argv.push(defaultCommand);
  }

  return execute({
    dir: dirname,
    development: options?.development,
    loadOptions: {
      root: dirname,
      pjson: {
        name: binName,
        version: "1.0",
        oclif: {
          bin: binName,
          description,
          topics: options?.topics,
          commands: {
            strategy: "explicit",
            target: filename,
            identifier: Object.keys({ allOclifCommands })[0],
          },
          topicSeparator: " ",
          helpClass: {
            target: filename,
            identifier: OclifHelp.name,
          },
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

/** Must export this symbol in main file */
export const allOclifCommands: Record<string, any> = {
  ...PluginAutoComplete.commands,
};

/**
 * Class decorator for adding Oclif command.
 */
export function command(
  name: string | string[],
  options?: {
    /** Parent command name */
    parent?: typeof Command;
  },
) {
  const joinedName = Array.isArray(name) ? name.join(":") : name;
  return (constructor: object) => {
    const fullName = options?.parent ? commandName(options.parent) + ":" + joinedName : joinedName;
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

/** Must export this class in main file */
export class OclifHelp extends Help {
  protected override getCommandHelpClass(command: Command.Loadable): CommandHelp {
    return new CommandHelp(
      { ...command, flags: mapKeys(command.flags, (key) => kebabCase(key)) },
      this.config,
      this.opts,
    );
  }
}

function commandName(command: typeof Command) {
  const name = Reflect.getMetadata("oclif:command-name", command) as string | undefined;
  assertNotNull(name, `Command ${command.name} not decorated with with "@command"`);
  return name;
}
