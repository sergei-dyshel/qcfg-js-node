/**
 * @file
 *
 *   Build command line by providing object whose keys are translated to command line parameters and
 *   values are translated to parameter values. The translation goes according to the schema which
 *   is object with same keys and values being handler functions that descrbe how to translate
 *   particular argument.
 *
 *   Usage:
 *
 *   ```ts
 *   import * as Cmd from "@sergei-dyshel/cmdline-builder";
 *
 *   const schema = Cmd.schema({
 *     boolFlag: Cmd.boolean(),
 *   });
 *
 *   const extendSchema = Cmd.extend(
 *    schema,
 *    Cmd.schema({stringFlag: Cmd.string()}
 *   );
 *
 *   Cmd.build(extendSchema, { boolFlag: true, stringFlag: "value" });
 *   // => ["--bool-flag", "--string-flag", "value"]
 * ```
 */

import { kebabCase } from "@sergei-dyshel/typescript/string";

/**
 * Specification of mapping from command line long option name to handler that describes how to
 * translate translate value to command line option value.
 */
export type Spec = Record<string, AnyHandler>;

/**
 * You are not supposed to use this type directly, use {@link schema} and {@link extend} function
 * instead.
 */
export type Schema = Spec;

export type Data<S extends Schema> = { [K in keyof S]+?: FromHandler<S[K]> };

/** Create schema out of spec. */
export function schema<S extends Spec>(spec: S): S {
  return spec;
}

export function extend<S1 extends Schema, S2 extends Schema>(s1?: S1, s2?: S2): S1 & S2 {
  return { ...s1, ...s2 } as S1 & S2;
}

export function boolean(options?: BooleanOptions): Handler<boolean> {
  return (name, value) => {
    const prefix = options?.invert ? "no-" : "";
    const val = value ?? options?.default ?? false;
    const emitOnVal = options?.invert ?? false;
    return val != emitOnVal ? [emitName(name, options, prefix)] : [];
  };
}

export function string(options?: CommonArgOptions): Handler<string> {
  return (name, value) => (value ? emitArg(name, value, options) : []);
}

export function number(options?: CommonArgOptions): Handler<number> {
  return (name, value) => (value ? emitArg(name, value.toString(), options) : []);
}

export function build<S extends Schema>(schema?: S, data?: Data<S>): string[] {
  if (!data) return [];
  return Object.entries(schema ?? {}).flatMap(([name, handler]) =>
    (handler as Handler<any>)(name, data[name]),
  );
}

export interface BooleanOptions extends CommonOptions {
  /**
   * Default value of the flag is `true` and when `false` value is specified, add a negated
   * command-line parameter by adding `no` prefix (unsless custom parameter name is specified).
   *
   * Example:
   *
   * ```ts
   * const schema = Cmd.schema({
   *   boolFlag: Cmd.boolean({ invert: true }),
   * });
   *
   * Cmd.build(schema, { boolFlag: true }); // => []
   * Cmd.build(schema, { boolFlag: false }); // => ["--no-bool-flag"]
   * // false by default, unless default: true in options
   * Cmd.build(schema, {}); // => ["--no-bool-flag"]
   * ```
   */
  invert?: boolean;

  /** Default value if not specified */
  default?: boolean;
}

type ArgType = string | number | boolean | string[] | number[];

type Handler<A extends ArgType> = (name: string, value: A | undefined) => string[];

type ToHandler<T> = T extends ArgType ? Handler<T> : never;

type FromHandler<T> = T extends Handler<infer A> ? A : never;

type AnyHandler = ToHandler<ArgType>;

interface CommonOptions {
  /** Custom option name, must be already in kebab-case */
  custom?: string;
}

interface CommonArgOptions extends CommonOptions {
  /** Emit argument as `--name=value` instead of `--name value` */
  equals?: boolean;
}

function emitName(name: string, options?: CommonOptions, prefix = ""): string {
  return options?.custom ?? "--" + prefix + kebabCase(name);
}

function emitArg(name: string, value: string, options?: CommonArgOptions): string[] {
  const emittedName = emitName(name, options);
  return options?.equals ? [`${emittedName}=${value}`] : [emittedName, value];
}
