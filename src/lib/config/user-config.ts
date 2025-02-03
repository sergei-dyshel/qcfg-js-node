import { jsoncParser, jsonStableStringify, yamlParse } from "@sergei-dyshel/typescript";
import { mapAsync } from "@sergei-dyshel/typescript/array";
import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { assertNotNull } from "@sergei-dyshel/typescript/error";
import { zodToJsonSchema, type zod } from "@sergei-dyshel/typescript/zod";
import { readFile, writeFile } from "fs/promises";
import { exists } from "../filesystem";
import { LogLevel, ModuleLogger } from "../logging";

const logger = new ModuleLogger({ name: "user-config" });
export class UserConfig<S extends zod.AnyZodObject> {
  private cached_?: UserConfig.Type<S>;

  constructor(
    readonly schema: S,
    readonly options?: { pathEnv?: string },
  ) {}

  async get() {
    if (!this.cached_) this.cached_ = await this.read();
    return this.cached_;
  }

  get cached() {
    assertNotNull(this.cached_, `User config was not read yet`);
    return this.cached_;
  }

  clearCache() {
    this.cached_ = undefined;
  }

  async writeJsonSchema(file?: string) {
    const jsonSchema = zodToJsonSchema(this.schema.partial());
    const str = jsonStableStringify(jsonSchema, { space: 2 });
    if (file) await writeFile(file, str);
    else process.stdout.write(str);
  }

  private async read(): Promise<UserConfig.Type<S>> {
    assertNotNull(this.options?.pathEnv, `UserConfig options is not initialized with path env var`);
    const paths = (process.env[this.options.pathEnv] ?? "").split(":");
    const configs = await mapAsync(paths, async (path) => this.readFile(path));
    return deepMerge(...configs.toReversed());
  }

  private async readFile(file: string): Promise<UserConfig.Type<S>> {
    if (!(await exists(file))) return {};
    const text = await readFile(file, "utf8");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const parsed = (() => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      if (file.endsWith(".yaml") || file.endsWith(".yml")) return yamlParse(text);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      if (file.endsWith(".json")) return jsoncParser.parse(text);
      throw new Error(`Unsupported user config file format: ${file}`);
    })();

    const result = this.schema.partial().safeParse(parsed);
    if (result.success) return result.data as UserConfig.Type<S>;
    logger.logError(result.error, {
      level: LogLevel.DEBUG,
      hideName: true,
      hideStack: true,
      prefix: `Failed to parse user config file ${file}: `,
    });
    return {};
  }
}

export namespace UserConfig {
  export type Type<S extends zod.AnyZodObject> = Partial<zod.infer<S>>;
}
