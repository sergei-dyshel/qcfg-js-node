/**
 * @file Test my custom additions to Oclif
 */

import { assertDeepEqual, assertRejects } from "@sergei-dyshel/typescript/error";
import { test } from "@sergei-dyshel/typescript/testing";
import {
  Args,
  argsInput,
  BaseCommand,
  Flags,
  flagsInput,
  OclifWrappedComandMissing,
  wrappedCommandArgs,
  type CommandArgs,
  type CommandError,
  type CommandFlags,
} from "../oclif";

abstract class TestCommand<T extends typeof BaseCommand> extends BaseCommand {
  protected declare flags: CommandFlags<T>;
  protected declare args: CommandArgs<T>;
  static override baseFlags = {} as const;

  override run() {
    return Promise.resolve({ args: this.args, flags: this.flags, argv: this.argv });
  }

  protected override async catch(err: CommandError) {
    throw err;
    return Promise.resolve();
  }
}

class CountTestCommand extends TestCommand<typeof CountTestCommand> {
  static override flags = flagsInput({
    str: Flags.string({ char: "s" }),
    count: Flags.count({ char: "c" }),
  });

  static override args = argsInput({
    arg: Args.string(),
  });
}

void test("count flag", async () => {
  let result = await CountTestCommand.run(["-ccsfoo"]);
  assertDeepEqual(result.flags, { str: "foo", count: 2 });

  result = await CountTestCommand.run(["-c", "-c", "--count", "-cc"]);
  assertDeepEqual(result.flags.count, 5);

  result = await CountTestCommand.run(["-c", "--", "-c"]);
  assertDeepEqual(result.args.arg, "-c");
  assertDeepEqual(result.flags.count, 1);
});

class MultiArgTestCommand extends TestCommand<typeof MultiArgTestCommand> {
  static override strict = false;
  static override args = argsInput({
    arg: Args.string(),
  });
  static override flags = flagsInput({
    flag: Flags.boolean({ char: "f" }),
  });
}

void test("multi arg", async () => {
  let result = await MultiArgTestCommand.run(["-f", "foo", "bar"]);
  assertDeepEqual(result.argv, ["foo", "bar"]);

  result = await MultiArgTestCommand.run(["-f", "--", "-f", "bar"]);
  assertDeepEqual(result.argv, ["-f", "bar"]);
});

class WrapperTestCommand extends TestCommand<typeof WrapperTestCommand> {
  static override args = wrappedCommandArgs();
  static override flags = flagsInput({
    str: Flags.string({ char: "s" }),
    count: Flags.count({ char: "c" }),
  });
}

void test("wrapper command", async () => {
  // no self-flags, only wrapped command
  let result = await WrapperTestCommand.run(["foo", "-a"]);
  assertDeepEqual(result.argv, ["foo", "-a"]);
  assertDeepEqual(result.flags.count, undefined);

  // self flag and wrapped command
  result = await WrapperTestCommand.run(["-c", "foo", "-c"]);
  assertDeepEqual(result.argv, ["foo", "-c"]);
  assertDeepEqual(result.flags.count, 1);

  // string flag and wrapped command
  result = await WrapperTestCommand.run(["-s", "foo", "bar"]);
  assertDeepEqual(result.argv, ["bar"]);
  assertDeepEqual(result.flags.str, "foo");

  // start with --
  result = await WrapperTestCommand.run(["--", "-s", "foo"]);
  assertDeepEqual(result.argv, ["-s", "foo"]);
  assertDeepEqual(result.flags.str, undefined);

  // no non-flag after -- but it's still ok
  result = await WrapperTestCommand.run(["-s", "foo", "--", "-a"]);
  assertDeepEqual(result.argv, ["-a"]);

  // empty argv - missing wrapped command
  await assertRejects(
    async () => {
      await WrapperTestCommand.run([]);
    },
    OclifWrappedComandMissing,
    "blabla",
  );

  // noexistent flag
  await assertRejects(
    async () => {
      await WrapperTestCommand.run(["-s", "foo", "-a"]);
    },
    /Nonexistent flag/,
    "blabla",
  );

  // no value for flag before --
  await assertRejects(
    async () => {
      await WrapperTestCommand.run(["-s", "--"]);
    },
    /expects a value/,
    "blabla",
  );

  // TEST: add cases with required flags
});
