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

import {
  Args,
  Command,
  CommandHelp,
  Config,
  execute,
  Help,
  type Interfaces,
  Flags as OclifFlags,
} from "@oclif/core";
import { CLIError } from "@oclif/core/errors";
import { Hook, type Hooks } from "@oclif/core/hooks";
import type {
  BooleanFlag,
  CommandError,
  FlagInput,
  InferredArgs,
  OclifConfiguration,
  PJSON,
} from "@oclif/core/interfaces";
import * as PluginAutoComplete from "@sergei-dyshel/oclif-plugin-autocomplete-cjs";
import { assert, assertNotNull } from "@sergei-dyshel/typescript/error";
import { DefaultMap } from "@sergei-dyshel/typescript/map";
import { mapKeys, objectEntries } from "@sergei-dyshel/typescript/object";
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

export { Args, CLIError, Command, CommandError, Config, Hook, type InferredArgs };

export class OclifError extends CLIError {}

export class OclifWrappedComandMissing extends OclifError {}

export namespace Flags {
  // Re-export oclif's Flags
  export const custom = OclifFlags.custom;
  export const string = OclifFlags.string;
  export const file = OclifFlags.file;
  export const integer = OclifFlags.integer;
  export const directory = OclifFlags.directory;

  type BooleanOpts = Partial<BooleanFlag<boolean>>;

  /**
   * A better version of {@link OclifFlags.boolean} that upon parsing will be inferred as `boolean`
   * or `boolean | undefined` (depending on presense of default value).
   *
   * {@link OclifFlags.boolean} will be inferred as `any`.
   */
  export function boolean(options: BooleanOpts & { default: boolean }): BooleanFlag<boolean>;
  export function boolean(options?: BooleanOpts): BooleanFlag<boolean | undefined>;
  export function boolean(options?: BooleanOpts) {
    return OclifFlags.boolean(options);
  }

  /**
   * Counts number of times flag was used.
   *
   * Used for e.g. verbosity, like `-vvv`.
   *
   * NOTE: Due to hacky nature of implmentation, when verbose flags are not given at all, will have
   * `undefined` value instead of zero.
   */
  export function count(
    options?: Partial<Omit<BooleanFlag<number>, "allowNo" | "default" | "parse">>,
  ) {
    return OclifFlags.boolean<number | undefined>({
      ...options,
      parse: (input, context, opts) => {
        assert(input);
        assert(!opts.allowNo);
        let count = 0;
        for (const arg of context.argv) {
          if (arg === "--") break;
          if (arg === "--" + opts.name) count++;
          if (opts.char) {
            const match = new RegExp(`^-(${opts.char}+)`).exec(arg);
            if (match) count += match[1].length;
          }
        }
        return Promise.resolve(count);
      },
    });
  }

  //
  // Common flags used in many CLI tools. Some of flag fields are pre-filled (but overridable).
  //

  export function force(options: BooleanOpts) {
    return flagsInput({ force: boolean({ char: "f", ...options }) });
  }

  export function verbose(options?: BooleanOpts) {
    return flagsInput({
      verbose: count({
        char: "v",
        summary: "Verbosity level. Can be used multiple times.",
        ...options,
      }),
    });
  }
}

/** Automatically sets `exclusive` for all other flags */
export function mutuallyExclusive<F extends FlagsInput>(flags: F): F {
  for (const [name, flag] of objectEntries(flags)) {
    flag.exclusive = Object.keys(flags).filter((key) => key !== name);
  }
  return flags;
}

/** Sets `exactlyOne` on all flags */
export function exactlyOne<F extends FlagsInput>(flags: F): F {
  const allFlags = Object.keys(flags);
  for (const flag of Object.values(flags)) {
    flag.exactlyOne = allFlags;
  }
  return flags;
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
  static override baseFlags = {} as const;

  static override strict = false;
  /**
   * Indicates that this command is wrapper for another command.
   *
   * In this case flags and args will not be parsed and can be accessed as is via
   * {@link Command.argv}.
   */
  protected get wrapper() {
    const args = Object.keys(this.ctor.args);
    if (args.includes(WRAPPED_COMMAND_ARG_NAME)) {
      assert(args.length === 1, "For wrapped command must use only one args");
      return true;
    }
    return false;
  }

  protected args!: CommandArgs<typeof BaseCommand>;
  protected flags!: CommandFlags<typeof BaseCommand>;

  public override async init(): Promise<void> {
    await super.init();

    const toKebabCase = (key: string) => kebabCase(key);
    const toCamelCase = (key: string) => camelCase(key);

    if (this.wrapper) {
      if (this.argv.length === 0) throw new OclifWrappedComandMissing("Wrapped command missing");
      // `parse()` will reset `argv` to passed value
      const savedArgv = this.argv;
      let n = 1;
      while (n <= savedArgv.length) {
        const argv = savedArgv.slice(0, n);
        const { args, flags, error } = await (async () => {
          try {
            const result = await this.parse(
              {
                flags: mapKeys(canBeUndefined(this.ctor.flags) ?? {}, toKebabCase),
                baseFlags: mapKeys(
                  canBeUndefined((super.ctor as typeof BaseCommand).baseFlags) ?? {},
                  toKebabCase,
                ),
                // special argument signalizing start of wrapped command
                args: argsInput({
                  command: Args.string(),
                }),
              },
              argv,
            );
            return { ...result, error: undefined };
          } catch (err) {
            if (err instanceof CLIError) return { args: undefined, flags: undefined, error: err };
            throw err;
          }
        })();
        if (error) {
          if (n === savedArgv.length || savedArgv[n] === "--") {
            throw error;
          }
          // at this stage Oclif error means some flag value or required flag is missing, so
          // try grabbing more tokens from argv
          n++;
          continue;
        }
        // if "command" arg filled by parsing, we reached first non-flag argument
        if (args.command) {
          this.flags = mapKeys(flags, toCamelCase) as typeof this.flags;
          this.argv = savedArgv.splice(n - 1);
          break;
        }
        if (n === savedArgv.length) throw new OclifWrappedComandMissing("Wrapped command missing");
        if (savedArgv[n] === "--") {
          this.flags = mapKeys(flags, toCamelCase) as typeof this.flags;
          this.argv = savedArgv.splice(n + 1);
          break;
        }
        n++;
      }
      return;
    }

    const { args, flags, argv } = await this.parse({
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
    this.argv = argv as string[];
  }
}

/**
 * Helper function to be used for {@link Command.flags} property to ensure proper type.
 */
export const flagsInput = extendsType<FlagsInput>();
export const argsInput = extendsType<ArgsInput>();

const WRAPPED_COMMAND_ARG_NAME = "__WRAPPED_CMD__";

/**
 * Specify that commands wraps another command.
 *
 * First non-flag argument or `--` will be used as start of wrapped command, which will be stored in
 * {@link Command.argv}.
 */
export function wrappedCommandArgs(description?: string) {
  return argsInput({
    [WRAPPED_COMMAND_ARG_NAME]: Args.string({
      description,
    }),
  });
}

export abstract class BaseCommandWithVerbosity extends BaseCommand {
  static override baseFlags = {
    ...super.baseFlags,
    ...Flags.verbose(),
  } as const;

  protected declare flags: CommandFlags<typeof BaseCommandWithVerbosity>;

  /** Log level when no verbose flags given. */
  protected verboseBaseLogLevel = LogLevel.WARNING;

  /** Use to override logging configuration in subclasses */
  protected logHandlerOptions: Omit<LogHandlerOptions, "level"> | undefined = {};

  protected configureLogging() {
    configureLogging({
      handler: {
        ...this.logHandlerOptions,
        level: LogLevels.addVerbosity(this.verboseBaseLogLevel, this.flags.verbose ?? 0),
      },
    });
  }
  /** Must call parent method when overriding */
  public override async init() {
    await super.init();
    this.configureLogging();
  }

  protected override catch(err: CommandError) {
    // If error happened before all arguments are parsed (e.g. wrong flags)
    if (!loggingConfigured()) return super.catch(err);

    logError(err, {
      hideName: this.flags.verbose == 0,
      hideStack: this.flags.verbose == 0,
    });
    this.exit(err.exitCode ?? 1);
    return Promise.resolve();
  }
}

/** Fixed version of {@link Interfaces.InferredFlags} */
export type InferredFlags<T> =
  T extends FlagInput<infer F>
    ? F & {
        json?: boolean | undefined;
      }
    : unknown;

/**
 * Use this type of when you want to assign parsed flags to variable.
 *
 * T - current command class, B - inherited command class
 */
export type CommandFlags<T extends typeof Command> = InferredFlags<T["baseFlags"] & T["flags"]>;

/**
 * Use this type of when you want to assign parsed flags to variable.
 */
export type CommandArgs<T extends typeof Command> = InferredArgs<T["args"]>;

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
            identifier: OCLIF_COMMANDS_SYMBOL_NAME,
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

export const OCLIF_COMMANDS_SYMBOL_NAME = Object.keys({ allOclifCommands })[0];

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

class MyCommandHelp extends CommandHelp {
  protected override usage() {
    if (!(WRAPPED_COMMAND_ARG_NAME in this.command.args)) return super.usage();

    // Oclif generates usage as "<args> <flags>" which will be misleading for wrapped command
    // as it must come after flags. So we remove wrapped command arg during usage generation
    // and modify usage manually
    const savedArgs = { ...this.command.args };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.command.args[WRAPPED_COMMAND_ARG_NAME];
    const usage = this.defaultUsage() + " [--] COMMAND...";
    this.command.args = savedArgs;
    return usage;
  }

  protected override args(args: Command.Arg.Any[]) {
    // Replace wrapped command arg name with readable name
    return super.args(
      args.map((arg) => {
        if (arg.name === WRAPPED_COMMAND_ARG_NAME) return { ...arg, name: "COMMAND" };
        return arg;
      }),
    );
  }
}

/** Must export this class in main file */
export class OclifHelp extends Help {
  protected override getCommandHelpClass(command: Command.Loadable): CommandHelp {
    return new MyCommandHelp(
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
