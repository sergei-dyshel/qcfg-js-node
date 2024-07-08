import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { LoggableError, assertNotNull } from "@sergei-dyshel/typescript/error";
import * as Cmd from "../cmdline-builder";
import { logByDefault, noCheck, runCommand, withOutErr, type RunOptions } from "./common";

/** Errors related to git config invocations */
export class Error extends LoggableError {}

/**
 * `git config --get`
 *
 * See: https://git-scm.com/docs/git-config
 *
 * Options:
 *
 * - `check`: If `true` throws an error if key is not found, otherwise returns `undefined`
 *
 * @returns Config value as string (but type can be enforced with `type` option or `undefined` if
 *   key is not found and `check` is `false`. Use {@link getInt} and {@link getBool} to convert value
 *   to proper type.
 */
export async function get(
  key: string,
  options?: OptionsWithType & { check?: boolean } & RunOptions,
): Promise<string | undefined>;
export async function get(
  key: string,
  options?: OptionsWithType & { check?: true } & RunOptions,
): Promise<string>;

export async function get(
  key: string,
  options?: OptionsWithType & { check?: boolean } & RunOptions,
) {
  const result = await runCommand(
    "config",
    ["--get", key],
    configSchema,
    deepMerge(options, withOutErr, noCheck),
  );
  if (result.exitCode == 1) {
    if (options?.check) throw new Error("Git config key not found: " + key);
    return undefined;
  }
  result.check();
  return result.stdout!.trimEnd();
}

/** Like {@link get} but force boolean type with `--type`. */
export async function getBool(
  key: string,
  options?: Options & { check?: false } & RunOptions,
): Promise<boolean | undefined>;
export async function getBool(
  key: string,
  options?: Options & { check: true } & RunOptions,
): Promise<boolean>;
export async function getBool(key: string, options?: Options & { check?: boolean } & RunOptions) {
  const val = await get(key, { ...options, type: "bool" });
  return val === undefined ? undefined : Boolean(val);
}

/** Like {@link get} but force integer type with `--type`. */
export async function getInt(
  key: string,
  options?: Options & { check?: false } & RunOptions,
): Promise<number | undefined>;
export async function getInt(
  key: string,
  options?: Options & { check: true } & RunOptions,
): Promise<number>;
export async function getInt(key: string, options?: Options & { check?: boolean } & RunOptions) {
  const val = await get(key, { ...options, type: "int" });
  return val === undefined ? undefined : Number(val);
}

/**
 * Like {@link get} but if key not defined return default value. The type of returned value is force
 * with `--type` and matches type of default value.
 */
export async function getDefault<T extends Value>(
  key: string,
  defaultValue: Value,
  options?: Omit<Options, "type" | "default"> & RunOptions,
): Promise<T> {
  const str = await get(key, {
    ...options,
    type: valueType(defaultValue),
    default: String(defaultValue),
  });
  assertNotNull(str);
  return (
    typeof defaultValue === "boolean"
      ? Boolean(str)
      : typeof defaultValue === "number"
        ? Number(str)
        : str
  ) as T;
}

/**
 * Set config value.
 *
 * See: https://git-scm.com/docs/git-config
 *
 * @param value If undefined then {@link unset} is called to delete value.
 */
export async function set(
  key: string,
  value: Value | undefined,
  options?: Omit<Options, "default"> & RunOptions,
) {
  if (value === undefined) return unset(key, options);
  return runCommand(["config"], [key, String(value)], configSchema, {
    ...deepMerge(options, logByDefault, withOutErr),
    type: valueType(value),
  });
}

export async function unset(key: string, options?: Omit<Options, "default"> & RunOptions) {
  return runCommand(
    ["config"],
    ["--unset", key],
    configSchema,
    deepMerge(options, logByDefault, withOutErr),
  );
}

export async function setUser(
  name: string,
  email: string,
  options?: Omit<Options, "default"> & RunOptions,
) {
  await set("user.name", name, options);
  await set("user.email", email, options);
}

const configSchema = Cmd.schema({
  global: Cmd.boolean(),
  local: Cmd.boolean(),
  type: Cmd.string(),
  default: Cmd.string(),
});

type Options = Cmd.Data<typeof configSchema>;
type OptionsWithType = Options & { type?: "bool" | "int" };

/** Supported config types */
type Value = string | number | boolean;

function valueType(value: Value) {
  return typeof value === "boolean" ? "bool" : typeof value === "number" ? "int" : undefined;
}
