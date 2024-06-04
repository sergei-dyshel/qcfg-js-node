/* eslint-disable @typescript-eslint/no-floating-promises */
import { assertDeepEqual } from "@sergei-dyshel/typescript/error";
import { test } from "@sergei-dyshel/typescript/testing";
import * as Cmd from "../cmdline-builder";

const schema = Cmd.schema({
  boolFlag: Cmd.boolean(),
});

test("single boolean flag", () => {
  assertDeepEqual(Cmd.build(schema, { boolFlag: true }), ["--bool-flag"]);
});

const invertBoolSchemaFalseByDefault = Cmd.schema({
  boolFlag: Cmd.boolean({ invert: true }),
});

test("invert boolean flag, false by default", () => {
  assertDeepEqual(Cmd.build(invertBoolSchemaFalseByDefault, { boolFlag: true }), []);
  assertDeepEqual(Cmd.build(invertBoolSchemaFalseByDefault, { boolFlag: false }), [
    "--no-bool-flag",
  ]);
  assertDeepEqual(Cmd.build(invertBoolSchemaFalseByDefault, {}), ["--no-bool-flag"]);
});

const invertBoolSchemaTrueByDefault = Cmd.schema({
  boolFlag: Cmd.boolean({ invert: true, default: true }),
});

test("invert boolean flag, true by default", () => {
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

test("extend schema", () => {
  assertDeepEqual(Cmd.build(extendSchema, { boolFlag: true, stringFlag: "value" }), [
    "--bool-flag",
    "--string-flag",
    "value",
  ]);
});

test("undefined schema", () => {
  assertDeepEqual(Cmd.build(undefined), []);
});

test("extend with undefined schema", () => {
  assertDeepEqual(Cmd.build(Cmd.extend(extendSchema, undefined), { boolFlag: true }), [
    "--bool-flag",
  ]);
});
