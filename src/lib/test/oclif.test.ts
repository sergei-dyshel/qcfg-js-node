/**
 * @file Test my custom additions to Oclif
 */

import { assertDeepEqual, assertRejects } from "@sergei-dyshel/typescript/error";
import { suite, test } from "@sergei-dyshel/typescript/testing";
import {
  Args,
  argsInput,
  BaseCommand,
  Flags,
  flagsInput,
  OclifRestArgsRequired,
  restArgs,
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

void suite.only("rest args", () => {
  class RestArgsTestCommand extends TestCommand<typeof RestArgsTestCommand> {
    static override args = restArgs();
    static override flags = flagsInput({
      str: Flags.string({ char: "s" }),
      count: Flags.count({ char: "c" }),
    });
  }

  void test("no self-flags, only rest args", async () => {
    const result = await RestArgsTestCommand.run(["foo", "-a"]);
    assertDeepEqual(result.argv, ["foo", "-a"]);
    assertDeepEqual(result.flags.count, undefined);
  });

  void test("bool flag and rest args", async () => {
    const result = await RestArgsTestCommand.run(["-c", "foo", "-c"]);
    assertDeepEqual(result.argv, ["foo", "-c"]);
    assertDeepEqual(result.flags.count, 1);
  });

  void test("string flag and rest args", async () => {
    const result = await RestArgsTestCommand.run(["-s", "foo", "bar"]);
    assertDeepEqual(result.argv, ["bar"]);
    assertDeepEqual(result.flags.str, "foo");
  });

  void test("start with --, only rest args", async () => {
    const result = await RestArgsTestCommand.run(["--", "-s", "foo"]);
    assertDeepEqual(result.argv, ["-s", "foo"]);
    assertDeepEqual(result.flags.str, undefined);
  });

  void test("flag as rest arg after --", async () => {
    const result = await RestArgsTestCommand.run(["-s", "foo", "--", "-a"]);
    assertDeepEqual(result.argv, ["-a"]);
    assertDeepEqual(result.flags.str, "foo");
  });

  void test("no flags or rest args", async () => {
    const result = await RestArgsTestCommand.run([]);
    assertDeepEqual(result.flags.str, undefined);
    assertDeepEqual(result.argv, []);
  });

  void test("noexistent flag", async () => {
    await assertRejects(async () => {
      await RestArgsTestCommand.run(["-s", "foo", "-a"]);
    }, /Nonexistent flag/);
  });

  void test("no value for flag before --", async () => {
    await assertRejects(async () => {
      await RestArgsTestCommand.run(["-s", "--"]);
    }, /expects a value/);
  });
});

void suite.only("required rest args", () => {
  class RequiredRestArgsTestCommand extends TestCommand<typeof RequiredRestArgsTestCommand> {
    static override args = restArgs({
      required: true,
    });
    static override flags = flagsInput({
      str: Flags.string({ char: "s" }),
      count: Flags.count({ char: "c" }),
    });
  }

  void test("empty argv - missing required rest args error", async () => {
    await assertRejects(async () => {
      await RequiredRestArgsTestCommand.run([]);
    }, OclifRestArgsRequired);
  });

  void test("just -- - missing required rest args error", async () => {
    await assertRejects(async () => {
      await RequiredRestArgsTestCommand.run([]);
    }, OclifRestArgsRequired);
  });
});

void suite.only("required arg and rest args", () => {
  class ArgAndRestArgsTestCommand extends TestCommand<typeof ArgAndRestArgsTestCommand> {
    static override args = argsInput({
      argument: Args.string({ required: true }),
      ...restArgs(),
    });
    static override flags = flagsInput({
      str: Flags.string({ char: "s" }),
      count: Flags.count({ char: "c" }),
    });
  }

  void test("empty argv - missing required arg error", async () => {
    await assertRejects(
      async () => ArgAndRestArgsTestCommand.run([]),
      /Missing 1 required arg.*argument/s,
    );
  });

  void test("-- and rest args", async () => {
    await assertRejects(
      async () => ArgAndRestArgsTestCommand.run(["--", "bar"]),
      /Missing 1 required arg.*argument/s,
    );
  });

  void test("only arg given", async () => {
    const result = await ArgAndRestArgsTestCommand.run(["foo"]);
    assertDeepEqual(result.args.argument, "foo");
    assertDeepEqual(result.argv, []);
  });

  void test("arg and rest args given", async () => {
    const result = await ArgAndRestArgsTestCommand.run(["foo", "bar"]);
    assertDeepEqual(result.args.argument, "foo");
    assertDeepEqual(result.argv, ["bar"]);
  });

  void test("arg, --, and rest args given", async () => {
    const result = await ArgAndRestArgsTestCommand.run(["foo", "--", "bar"]);
    assertDeepEqual(result.args.argument, "foo");
    assertDeepEqual(result.argv, ["bar"]);
  });

  void test("arg and --", async () => {
    const result = await ArgAndRestArgsTestCommand.run(["foo", "--"]);
    assertDeepEqual(result.args.argument, "foo");
    assertDeepEqual(result.argv, []);
  });
});
