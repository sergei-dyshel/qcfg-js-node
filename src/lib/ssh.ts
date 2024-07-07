import { fail } from "@sergei-dyshel/typescript/error";
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

export const WEAK_AUTH_SSH_CONFIG: SshConfig = {
  GSSAPIAuthentication: false,
  StrictHostKeyChecking: false,
  UserKnownHostsFile: "none",
};

function configValueToString(val: unknown) {
  if (typeof val === "boolean") return val ? "yes" : "no";
  if (typeof val === "string") return val;
  fail(`Unsupported SSH config value type: ${typeof val}`, val);
}

function sshConfigToParams(config?: SshConfig) {
  return Object.entries(config ?? {}).flatMap(([key, value]) => [
    "-o",
    `${key}=${configValueToString(value)}`,
  ]);
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
  const configParams = sshConfigToParams(options?.config);
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
