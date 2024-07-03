import { upperCamelCase } from "@sergei-dyshel/typescript/string";
import * as Cmd from "./cmdline-builder";
import { Runner, type RunFunc } from "./runner";
import { logRun, run, type Command, type RunLogOptions, type RunOptions } from "./subprocess";

const sshSchema = Cmd.schema({
  quiet: Cmd.boolean({ custom: "-q" }),
  key: Cmd.string({ custom: "-i" }),
  port: Cmd.number({ custom: "-p" }),
  tty: Cmd.boolean({ custom: "-t" }),
  jumpHost: Cmd.string({ custom: "-J" }),
  logFile: Cmd.string({ custom: "-E" }),
  configFile: Cmd.string({ custom: "-F" }),
});

export interface SshConfig {
  proxyCommand?: string;
}

export type SshRunOptions = Cmd.Data<typeof sshSchema> & {
  config?: SshConfig;
} & {
  log?: RunLogOptions;
  runFunc?: RunFunc;
  run?: RunOptions;
};

export function sshRun(host: string, command?: Command, options?: SshRunOptions) {
  const params = Cmd.build(sshSchema, options);
  const configParams = Object.entries(options?.config ?? {}).flatMap(([key, value]) => [
    "-o",
    `${upperCamelCase(key)}=${value}`,
  ]);
  const cmd = [
    "ssh",
    ...params,
    ...configParams,
    host,
    ...(typeof command === "string" ? [command] : command ?? []),
  ];
  if (command) logRun(command, options?.log);
  return (options?.runFunc ?? run)(cmd, options?.run);
}

export class SshRunner extends Runner<SshRunOptions> {
  constructor(
    public readonly host: string,
    options?: SshRunOptions,
  ) {
    super((command, options) => sshRun(this.host, command, options), options);
  }
}
