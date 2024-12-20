/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/**
 * @file Everything related to git config.
 *
 *   See: https://git-scm.com/docs/git-config
 */
import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { LoggableError } from "@sergei-dyshel/typescript/error";
import * as Cmd from "../cmdline-builder";
import { logByDefault, noCheck, runCommand, withOutErr, type RunOptions } from "./common";

/** Errors related to git config invocations */
export class Error extends LoggableError {}

/**
 * `git config --get`
 *
 * Options:
 *
 * - `type`: If specified, enforces type of returned value. If not specified and key is known then
 *   type is inferred from key, otherwise type is `string`.
 * - `check`: If `true` throws an error if key is not found, otherwise returns `undefined`
 */
export async function get<K extends keyof KnownKeys>(
  key: K,
  options?: Options & { type?: undefined; check: true } & RunOptions,
): Promise<ValueTypeToValue<KnownKeys[K]>>;
export async function get<K extends keyof KnownKeys>(
  key: K,
  options?: Options & { type?: undefined; check?: undefined | boolean } & RunOptions,
): Promise<ValueTypeToValue<KnownKeys[K]> | undefined>;

export async function get<T extends ValueType | undefined>(
  key: string,
  options?: Options & { type?: T; check: true } & RunOptions,
): Promise<ValueTypeToValue<T>>;
export async function get<T extends ValueType | undefined>(
  key: string,
  options?: Options & { type?: T; check?: undefined | boolean } & RunOptions,
): Promise<ValueTypeToValue<T> | undefined>;

export async function get(
  key: string,
  options?: OptionsWithType & { check?: boolean } & RunOptions,
): Promise<Value | undefined> {
  const type = options?.type ?? (key in knownKeys ? knownKeys[key as keyof KnownKeys] : undefined);
  const result = await runCommand("config", ["--get", key], configSchema, {
    ...deepMerge(options, withOutErr, noCheck),
    type: type === "string" ? undefined : type,
  });
  if (result.exitCode == 1) {
    if (options?.check) throw new Error("Git config key not found: " + key);
    return undefined;
  }
  result.check();
  const value = result.stdout!.trimEnd();
  switch (type) {
    case "bool":
      return Boolean(value);
    case "int":
      return Number(value);
    case "string":
    case undefined:
      return value;
  }
}

const globalGet = get;

/**
 * Git config --set
 *
 * @param value If `key` is known then value type must match it. If undefined then {@link unset} is
 *   called to delete value.
 */

export async function set<K extends string | keyof KnownKeys>(
  key: K,
  value: ValueTypeToValue<KeyToValueType<K>> | undefined,
  options?: Options & RunOptions,
): Promise<void> {
  if (value === undefined) return unset(key, options);
  await runCommand(["config"], [key, String(value)], configSchema, {
    ...deepMerge(options, logByDefault, withOutErr),
    type: valueType(value),
  });
}

export async function unset(
  key: keyof KnownKeys | string,
  options?: Omit<Options, "default"> & RunOptions,
) {
  await runCommand(
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

/** Getting/setting "remote.<name>.<key>" configs */
export namespace Remote {
  export async function get<K extends keyof KnownRemoteKeys>(
    remote: string,
    key: K,
    options?: Options & { type?: undefined; check: true } & RunOptions,
  ): Promise<ValueTypeToValue<KnownRemoteKeys[K]>>;
  export async function get<K extends keyof KnownRemoteKeys>(
    remote: string,
    key: K,
    options?: Options & { type?: undefined; check?: undefined | boolean } & RunOptions,
  ): Promise<ValueTypeToValue<KnownRemoteKeys[K]> | undefined>;

  export async function get<T extends ValueType | undefined>(
    remote: string,
    key: string,
    options?: Options & { type?: T; check: true } & RunOptions,
  ): Promise<ValueTypeToValue<T>>;
  export async function get<T extends ValueType | undefined>(
    remote: string,
    key: string,
    options?: Options & { type?: T; check?: undefined | boolean } & RunOptions,
  ): Promise<ValueTypeToValue<T> | undefined>;

  export async function get(
    remote: string,
    key: string,
    options?: OptionsWithType & { check?: boolean } & RunOptions,
  ): Promise<Value | undefined> {
    return globalGet(`remote.${remote}.${key}`, options);
  }
}

const configSchema = Cmd.schema({
  global: Cmd.boolean(),
  local: Cmd.boolean(),
  type: Cmd.string(),
});

type Options = Omit<Cmd.Data<typeof configSchema>, "type">;
type ValueType = "bool" | "int" | "string";
type OptionsWithType = Options & { type?: ValueType | undefined };

/** Supported config types */
type Value = string | number | boolean;

function valueType(value: Value) {
  return typeof value === "boolean" ? "bool" : typeof value === "number" ? "int" : undefined;
}

const knownKeys = {
  "user.name": "string",
  "user.email": "string",

  /**
   * Set the length object names are abbreviated to.
   *
   * String values `auto` and `no` are not supported here.
   * https://git-scm.com/docs/git-config/#Documentation/git-config.txt-coreabbrev
   */
  "core.abbrev": "int",

  /**
   * When set to true, automatically create a temporary stash entry before the operation begins, and
   * apply it after the operation ends.
   *
   * https://git-scm.com/docs/git-config/#Documentation/git-config.txt-rebaseautoStash
   */
  "rebase.autoStash": "bool",
} as const;

type KnownKeys = typeof knownKeys;

type ValueTypeToValue<T extends ValueType | undefined> = T extends "bool"
  ? boolean
  : T extends "int"
    ? number
    : string;

type KeyToValueType<K extends string | keyof KnownKeys> = K extends keyof KnownKeys
  ? KnownKeys[K]
  : ValueType;

const knownRemoteKeys = {
  /**
   * The URL of a remote repository.
   *
   * https://git-scm.com/docs/git-config/#Documentation/git-config.txt-remoteltnamegturl
   */
  url: "string",

  /**
   * The default set of "refspec" for git-fetch.
   *
   * https://git-scm.com/docs/git-config/#Documentation/git-config.txt-remoteltnamegtfetch
   */
  fetch: "string",

  /**
   * The default program to execute on the remote side when pushing.
   *
   * https://git-scm.com/docs/git-config/#Documentation/git-config.txt-remoteltnamegtreceivepack
   */
  receivepack: "string",
} as const;

type KnownRemoteKeys = typeof knownRemoteKeys;
