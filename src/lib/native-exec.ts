import { LoggableError } from "@sergei-dyshel/typescript/error";
import { spawnSync } from "child_process";
import { join } from "path";
import type * as Subprocess from "./subprocess";

let globalRoot: string;

function getGlobalRoot() {
  if (!globalRoot) {
    // TODO: move to subprocess module when it has spawnSync
    const result = spawnSync("npm", ["root", "-g"], { stdio: "pipe", encoding: "utf8" });
    globalRoot = result.stdout.trim();
  }
  return globalRoot;
}

function requireGlobalModule(name: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return require(join(getGlobalRoot(), name));
  } catch (err) {
    throw new GlobalModuleRequireError(`Failed to import global module ${name}`, { cause: err });
  }
}

/**
 * Run POSIX exec call. See {@link https://www.npmjs.com/package/@triggi/native-exec}.
 */
export function nativeExec(command: Subprocess.Command, newEnv?: Record<string, string>): never {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const nativeExec = requireGlobalModule("@triggi/native-exec");
  if (typeof command === "string")
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    nativeExec("/bin/sh", newEnv, "-c", command);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  else nativeExec(command[0], newEnv, command.slice(1));
  throw new Error("if reached here, native exec did not work");
}

/**
 * Same as {@link nativeExec} but with signature suitable to be used as {@link Subprocess.Runner}.
 *
 * NOTE: Any options are ignored.
 */
export function nativeExecRunner(
  command: Subprocess.Command,
  _?: Subprocess.RunOptions,
): Promise<Subprocess.RunResult> {
  nativeExec(command);
}

export class GlobalModuleRequireError extends LoggableError {}
