import yargs from "yargs";

const commonOptions = {
  "some-common": { type: "boolean", desc: "Some common option" },
} as const;

function addCommonOptions<T>(argv: yargs.Argv<T>) {
  return argv.options(commonOptions);
}

export type O = yargs.ArgumentsCamelCase<yargs.InferredOptionTypes<typeof commonOptions>>;

async function main() {
  await yargs(process.argv.slice(2))
    .options({
      common: { type: "boolean", alias: "c", describe: "Common option", group: "Common options" },
    })
    .command(
      "first [<arg>]",
      "First subcommand",
      (yargs) =>
        addCommonOptions(
          yargs.positional("arg", { type: "string", default: "def" }).options({
            opt: { type: "string" },
            choice: { type: "string", choices: ["one", "two", "three"] as const },
          }),
        ),
      (args) => {
        console.log("first options", args);
      },
    )
    .command(
      "second",
      "Second command",
      (yargs) => addCommonOptions(yargs),
      (args) => {
        console.log("second options", args);
      },
    )
    .strict()
    .completion()
    .parserConfiguration({
      "strip-aliased": true,
      // @ts-expect-error
      "hide-types": true,
      // "strip-dashed": true,
    })
    .parse();
}

void main();
