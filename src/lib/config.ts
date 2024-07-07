import { jsoncParser } from "@sergei-dyshel/typescript";
import { assert } from "@sergei-dyshel/typescript/error";
import type { zod } from "@sergei-dyshel/typescript/zod";
import { readFile } from "node:fs/promises";
import { ModuleLogger } from "./logging";

const logger = new ModuleLogger();

type Spec = Record<
  string,
  {
    schema: zod.ZodTypeAny;
  }
>;

export class Config<Section extends string, S extends Spec> {
  private loaded = false;
  private text?: string;
  private json?: any;

  constructor(
    private readonly section: Section,
    private readonly spec: S,
  ) {}

  async load(filePath: string) {
    this.text = await readFile(filePath, "utf8");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.json = jsoncParser.parse(this.text);
    this.loaded = true;
  }

  get<K extends Extract<keyof S, string>>(
    key: `${Section}.${K}`,
  ): zod.infer<S[K]["schema"]> | undefined;
  get<K extends Extract<keyof S, string>>(
    key: `${Section}.${K}`,
    defaultValue: zod.infer<S[K]["schema"]>,
  ): zod.infer<S[K]["schema"]>;
  get(key: string, defaultValue?: any) {
    assert(this.loaded, "Should load config before accessing it");
    const fullkey = `${this.section}.${key}`;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    const data = this.json[fullkey];
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return this.spec[key].schema.parse(data);
    } catch (err) {
      logger.logError(err, { prefix: `Failed to parse config "${fullkey}": ` });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return defaultValue;
    }
  }
}
