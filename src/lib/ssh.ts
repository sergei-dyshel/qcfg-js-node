import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { fail } from "@sergei-dyshel/typescript/error";
import { omit } from "@sergei-dyshel/typescript/object";
import type { FunctionWithArgs, Tail } from "@sergei-dyshel/typescript/types";
import * as Fs from "node:fs/promises";
import * as Cmd from "./cmdline-builder";
import * as Subprocess from "./subprocess";
import { joinCommand, logRun, type Command, type RunLogOptions, type Runner } from "./subprocess";

export const LOCALHOST = "localhost";

export class Instance {
  constructor(
    readonly host: string,
    readonly sshOptions?: RunCommandOptions,
  ) {}

  run(command: Command, options?: RunCommandOptions) {
    return runCommand(this.host, command, deepMerge(this.sshOptions, options));
  }

  writeFile = this.wrap(writeFile);
  readFile = this.wrap(readFile);

  runner() {
    return runner(this.host, this.sshOptions);
  }

  // TYPING: only accept valid functions
  private wrap<F extends FunctionWithArgs>(fn: F) {
    return ((...args: Tail<Parameters<F>>) => {
      // `args` is missing first argument from `fn` signature, so last argument is `fn.length - 2
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      args[fn.length - 2] = deepMerge(this.sshOptions, args[fn.length - 2]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return fn(this.host, ...args);
    }) as (...args: Tail<Parameters<F>>) => ReturnType<F>;
  }
}
export interface Config {
  /** https://www.mankier.com/5/ssh_config#ProxyCommand */
  ProxyCommand?: string;

  /** Specifies whether user authentication based on GSSAPI is allowed. The default is no. */
  GSSAPIAuthentication?: boolean;

  /** https://www.mankier.com/5/ssh_config#StrictHostKeyChecking */
  StrictHostKeyChecking?: "ask" | "accept-new" | boolean;

  /** https://www.mankier.com/5/ssh_config#UserKnownHostsFile */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  UserKnownHostsFile?: string | "none";

  /** https://www.mankier.com/5/ssh_config#ControlPersist */
  ControlPersist?: number | boolean;

  /** https://www.mankier.com/5/ssh_config#ServerAliveInterval */
  ServerAliveInterval?: number;

  /** https://www.mankier.com/5/ssh_config#ServerAliveCountMax */
  ServerAliveCountMax?: number;
}

export const WEAK_AUTH_SSH_CONFIG: Config = {
  GSSAPIAuthentication: false,
  StrictHostKeyChecking: false,
  UserKnownHostsFile: "none",
};

export type RunOptions = Cmd.Data<typeof sshSchema> & {
  config?: Config;
} & {
  /**
   * Logging options for command run via SSH.
   *
   * To log full SSH command line pass options to `run` or `runner`.
   */
  log?: RunLogOptions;

  runner?: Subprocess.Runner;
  run?: Subprocess.RunOptions;
};

/**
 * Run SSH interactively or execute a command
 */
export function run(host: string, command?: Command, options?: RunOptions) {
  const params = Cmd.build(sshSchema, options);
  const configParams = sshConfigToParams(options?.config);
  const cmd = [
    "ssh",
    ...params,
    ...configParams,
    host,
    ...(typeof command === "string" ? [command] : command ?? []),
  ];
  if (command) logRun(command, options?.log);
  return (options?.runner ?? Subprocess.run)(cmd, options?.run);
}

export type RunCommandOptions = {
  cwd?: string;
} & RunOptions;

/**
 * Wraps over {@link run} and supports more options.
 */
export function runCommand(host: string, command: Command, options?: RunCommandOptions) {
  const cmd: Command = options?.cwd
    ? `set -e; cd ${options.cwd}; ${joinCommand(command)}`
    : command;
  logRun(command, options?.log);
  return run(host, cmd, omit(options, "log"));
}

/**
 * Create {@link Runner} to run commands over SSH that can be passed to any function accepting
 * generic runner (e.g. Git).
 */
export function runner(host: string, sshOptions?: RunCommandOptions): Runner {
  return (command, options) =>
    runCommand(
      host,
      command,
      // `log` parameter given in Subprocess.RunOptions  will be used to log SSH command itself and not full shell line
      deepMerge(sshOptions, { log: options?.log }, { run: omit(options, "log") }),
    );
}

/**
 * Similar to {@link Fs.writeFile}, write file over SSH. Uses `cat`
 */
export async function writeFile(
  host: string,
  path: string,
  text: string,
  options?: {
    /**
     * Similiar to `mode` parameter to {@link Fs.writeFile} but always changes permissions with chmod
     * if given (not just on new file)
     */
    mode?: number;
  } & RunCommandOptions,
) {
  await runCommand(host, `cat >${path}`, deepMerge(options, { run: { input: text, check: true } }));
  if (options?.mode) await runCommand(host, ["chmod", options.mode.toString(8), path], options);
}

/**
 * Similar to {@link Fs.readFile}, read file contents over SSH. Uses `cat`.
 */
export async function readFile(host: string, path: string, options?: RunCommandOptions) {
  const result = await runCommand(
    host,
    `cat ${path}`,
    deepMerge(options, { run: { stdout: "pipe", check: true } }),
  );
  return result.stdout!;
}

const sshSchema = Cmd.schema({
  quiet: Cmd.boolean({ custom: "-q" }),
  key: Cmd.string({ custom: "-i" }),
  port: Cmd.number({ custom: "-p" }),
  tty: Cmd.boolean({ custom: "-t" }),
  jumpHost: Cmd.string({ custom: "-J" }),
  logFile: Cmd.string({ custom: "-E" }),
  configFile: Cmd.string({ custom: "-F" }),
});

function configValueToString(val: unknown) {
  if (typeof val === "boolean") return val ? "yes" : "no";
  if (typeof val === "string") return val;
  if (typeof val === "number") return val.toString();
  fail(`Unsupported SSH config value type: ${typeof val}`, val);
}

function sshConfigToParams(config?: Config) {
  return Object.entries(config ?? {}).flatMap(([key, value]) => [
    "-o",
    `${key}=${configValueToString(value)}`,
  ]);
}
