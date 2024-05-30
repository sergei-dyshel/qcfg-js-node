/* eslint-disable @typescript-eslint/no-floating-promises */
import { Assert } from "@sergei-dyshel/typescript/error";
import { Test } from "@sergei-dyshel/typescript/testing";
import * as Cmd from "../cmdline-builder";

const schema = Cmd.schema({
  boolFlag: Cmd.boolean(),
});

Test.test("single boolean flag", () => {
  Assert.deepEqual(Cmd.build(schema, { boolFlag: true }), ["--bool-flag"]);
});

const invertBoolSchemaFalseByDefault = Cmd.schema({
  boolFlag: Cmd.boolean({ invert: true }),
});

Test.test("invert boolean flag, false by default", () => {
  Assert.deepEqual(Cmd.build(invertBoolSchemaFalseByDefault, { boolFlag: true }), []);
  Assert.deepEqual(Cmd.build(invertBoolSchemaFalseByDefault, { boolFlag: false }), [
    "--no-bool-flag",
  ]);
  Assert.deepEqual(Cmd.build(invertBoolSchemaFalseByDefault, {}), ["--no-bool-flag"]);
});

const invertBoolSchemaTrueByDefault = Cmd.schema({
  boolFlag: Cmd.boolean({ invert: true, default: true }),
});

Test.test("invert boolean flag, true by default", () => {
  Assert.deepEqual(Cmd.build(invertBoolSchemaTrueByDefault, { boolFlag: true }), []);
  Assert.deepEqual(Cmd.build(invertBoolSchemaTrueByDefault, { boolFlag: false }), [
    "--no-bool-flag",
  ]);
  Assert.deepEqual(Cmd.build(invertBoolSchemaTrueByDefault, {}), []);
});

const extendSchema = {
  ...schema,
  stringFlag: Cmd.string(),
};

Test.test("extend schema", () => {
  Assert.deepEqual(Cmd.build(extendSchema, { boolFlag: true, stringFlag: "value" }), [
    "--bool-flag",
    "--string-flag",
    "value",
  ]);
});

Test.test("undefined schema", () => {
  Assert.deepEqual(Cmd.build(undefined), []);
});

Test.test("extend with undefined schema", () => {
  Assert.deepEqual(Cmd.build(Cmd.extend(extendSchema, undefined), { boolFlag: true }), [
    "--bool-flag",
  ]);
});
