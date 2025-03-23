import { dedent } from "@sergei-dyshel/typescript/string";
import { zod } from "@sergei-dyshel/typescript/zod";
import { UserConfig } from "./user-config";

const schema = zod.object({
  syg: zod.object({
    execSource: zod.string().optional().describe(dedent`
      Shell file to source on remote when running syg.exec
      `),
  }),
  rsync: zod.object({
    defaultRemoteRsyncPath: zod.string().optional().describe(dedent`
      Default path to remote rsync binary file
      `),
  }),

  baseTempDir: zod.string().optional().describe(dedent`
    Path to prefix directory for temporary files
    `),
});

export type UserConfigType = UserConfig.Type<typeof schema>;

export const userConfig = new UserConfig(schema, { pathEnv: "QCFG_JS_CONFIG_PATH" });
