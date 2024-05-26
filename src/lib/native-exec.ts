import { spawnSync } from "child_process";
import { join } from "path";
import type { Command } from "./subprocess";

let globalRoot: string;

function getGlobalRoot() {
  if (!globalRoot) {
    // TODO: move to subprocess module when it has spawnSync
    const result = spawnSync("npm", ["root", "-g"], { stdio: "pipe", encoding: "utf8" });
    console.log(result);
    globalRoot = result.stdout.trim();
  }
  return globalRoot;
}

function requireGlobalModule(name: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return require(join(getGlobalRoot(), name));
}

export function exec(command: Command, newEnv?: Record<string, string>): never {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const nativeExec = requireGlobalModule("@triggi/native-exec");
  if (typeof command === "string")
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    nativeExec("/bin/sh", newEnv, "-c", command);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  else nativeExec(command[0], newEnv, command.slice(1));
  throw new Error("if reached here, native exec did not work");
}
