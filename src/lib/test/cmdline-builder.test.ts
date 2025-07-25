import { assertDeepEqual } from "@sergei-dyshel/typescript/error";
import { suite, test } from "@sergei-dyshel/typescript/testing";
import * as Cmd from "../cmdline-builder";

const schema = Cmd.schema({
  boolFlag: Cmd.boolean(),
});

void test("single boolean flag", () => {
  assertDeepEqual(Cmd.build(schema, { boolFlag: true }), ["--bool-flag"]);
});

const invertBoolSchemaFalseByDefault = Cmd.schema({
  boolFlag: Cmd.boolean({ invert: true }),
});

void test("invert boolean flag, false by default", () => {
  assertDeepEqual(Cmd.build(invertBoolSchemaFalseByDefault, { boolFlag: true }), []);
  assertDeepEqual(Cmd.build(invertBoolSchemaFalseByDefault, { boolFlag: false }), [
    "--no-bool-flag",
  ]);
  assertDeepEqual(Cmd.build(invertBoolSchemaFalseByDefault, {}), ["--no-bool-flag"]);
});

const invertBoolSchemaTrueByDefault = Cmd.schema({
  boolFlag: Cmd.boolean({ invert: true, default: true }),
});

void test("invert boolean flag, true by default", () => {
  assertDeepEqual(Cmd.build(invertBoolSchemaTrueByDefault, { boolFlag: true }), []);
  assertDeepEqual(Cmd.build(invertBoolSchemaTrueByDefault, { boolFlag: false }), [
    "--no-bool-flag",
  ]);
  assertDeepEqual(Cmd.build(invertBoolSchemaTrueByDefault, {}), []);
});

const extendSchema = {
  ...schema,
  stringFlag: Cmd.string(),
};

void test("extend schema", () => {
  assertDeepEqual(Cmd.build(extendSchema, { boolFlag: true, stringFlag: "value" }), [
    "--bool-flag",
    "--string-flag",
    "value",
  ]);
});

void test("undefined schema", () => {
  assertDeepEqual(Cmd.build(undefined), []);
});

void test("extend with undefined schema", () => {
  assertDeepEqual(Cmd.build(Cmd.extend(extendSchema, undefined), { boolFlag: true }), [
    "--bool-flag",
  ]);
});

void test("string argument with equals sign", () => {
  assertDeepEqual(
    Cmd.build(
      Cmd.schema({
        stringFlag: Cmd.string({ equals: true }),
      }),
      { stringFlag: "value" },
    ),
    ["--string-flag=value"],
  );
});

void suite.only("count argument", () => {
  void test("count argument with full name", () => {
    assertDeepEqual(
      Cmd.build(
        Cmd.schema({
          countFlag: Cmd.count(),
        }),
        { countFlag: 3 },
      ),
      ["--count-flag", "--count-flag", "--count-flag"],
    );
  });

  void test("count argument with char", () => {
    assertDeepEqual(
      Cmd.build(
        Cmd.schema({
          countFlag: Cmd.count({ char: "v" }),
        }),
        { countFlag: 3 },
      ),
      ["-vvv"],
    );
  });

  void test("zero count (long opt)", () => {
    assertDeepEqual(
      Cmd.build(
        Cmd.schema({
          countFlag: Cmd.count(),
        }),
        { countFlag: 0 },
      ),
      [],
    );
  });

  void test("zero count (short opt)", () => {
    assertDeepEqual(
      Cmd.build(
        Cmd.schema({
          countFlag: Cmd.count({ char: "v" }),
        }),
        { countFlag: 0 },
      ),
      [],
    );
  });
});
