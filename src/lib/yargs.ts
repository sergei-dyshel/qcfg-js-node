import { extendsType } from "@sergei-dyshel/typescript/types";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

export type Argv<T = {}> = yargs.Argv<T>;

/** Create default yargs instance */
export function create(options?: {
  /**
   * Should parsing stop at the first text argument? This is similar to how e.g. ssh parses its
   * command line. Default is `false`
   */
  haltAtNonOptions?: boolean;

  /**
   * Add command for completion script generation. Default is `true`
   */
  completion?: boolean;
}) {
  let y = yargs(hideBin(process.argv));

  // hide type names, not documented or typed yet
  // see https://github.com/yargs/yargs/issues/792
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  y = (y as any).usageConfiguration({ "hide-types": true }) as Argv;

  y = y
    .demandCommand()
    .recommendCommands()
    .strict()
    // .usageConfiguration({'hide-types': true})
    .parserConfiguration({
      "strip-aliased": true,
      "parse-numbers": false,
      // not sure this one needed
      "parse-positional-numbers": false,
      "halt-at-non-option": options?.haltAtNonOptions,
    });

  if (options?.completion ?? true) {
    y = y.completion();
  }

  return y;
}

/** For use in commands that don't need builder argument */
export const emptyBuilder = (y: Argv) => y;

const options = extendsType<Record<string, yargs.Options>>();

/** Verbosity options that can be used multiple times */
export const verbose = options({
  verbose: { type: "boolean", alias: "v", count: true },
});
