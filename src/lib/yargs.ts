import { formatError } from "@sergei-dyshel/typescript/error";
import { extendsType } from "@sergei-dyshel/typescript/types";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { configureLogging, LogLevel, LogLevels } from "./logging";
import { OnTerminate } from "./process";

export type { Argv, InferredOptionTypes } from "yargs";

/** Create default yargs instance */
export function create(options?: {
  /**
   * Use commands (true by default)
   */
  commands?: boolean;

  /**
   * Should parsing stop at the first text argument? This is similar to how e.g. ssh parses its
   * command line. Default is `false`
   */
  haltAtNonOptions?: boolean;

  /**
   * Add command for completion script generation. Default is `true`
   */
  completion?: boolean;

  /**
   * Should a group of short-options be treated as boolean flags? Default is `true`
   *
   * Must be set to false to enable short options with value to work without space e.g.
   * `-o<output>`.
   */
  shortOptionGroups?: boolean;

  /**
   * Do not add default handler
   */
  noFail?: boolean;
}) {
  let y = yargs(hideBin(process.argv));

  // hide type names, not documented or typed yet
  // see https://github.com/yargs/yargs/issues/792
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  y = (y as any).usageConfiguration({
    "hide-types": true,
  }) as yargs.Argv;

  if (options?.commands ?? true) {
    y = y.demandCommand().recommendCommands();
  }

  y = y
    .strict()
    // .usageConfiguration({'hide-types': true})
    .parserConfiguration({
      "strip-aliased": true,
      "parse-numbers": false,
      // not sure this one needed
      "parse-positional-numbers": false,
      "short-option-groups": options?.shortOptionGroups ?? true,
      "halt-at-non-option": options?.haltAtNonOptions,
    });

  if (!options?.noFail) {
    y = y.fail((msg, err, _yargs) => {
      defaultFail(msg, err);
    });
  }

  if (options?.completion ?? true) {
    y = y.completion();
  }

  return y;
}

export function defaultFail(msg: string, err: Error, options?: { showCause?: boolean }) {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (err) {
    if (OnTerminate.killIfCausedBy(err)) return;
    process.stderr.write(formatError(err, options) + "\n");
    // some errors may set exit code, we do not want to override it
    if (process.exitCode === undefined) process.exitCode = 1;
    process.exit();
  } else {
    process.stderr.write(msg + "\n");
    process.exit(1);
  }
}

/** For use in commands that don't need builder argument */
export const emptyBuilder = (y: yargs.Argv) => y;

export const opt = extendsType<yargs.Options>();

export const options = extendsType<Record<string, yargs.Options>>();

/** Verbosity options that can be used multiple times */
export const verbose = options({
  verbose: { type: "boolean", alias: "v", count: true, describe: "Verbosity level" },
});

export function addVerbose<T>(yargs: yargs.Argv<T>, options?: { baseLogLevel?: LogLevel }) {
  return yargs.options(verbose).middleware((opts) => {
    configureLogging({
      handler: {
        level: LogLevels.addVerbosity(options?.baseLogLevel ?? LogLevel.WARNING, opts.verbose),
      },
    });
  });
}
