import { emptyDir } from "@sergei-dyshel/node/filesystem";
import { jsonStableStringify } from "@sergei-dyshel/typescript/json";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GlobalLock } from "./lock";
import { InstanceLogger, ModuleLogger } from "./logging";

const OBJ_DIR = "objects";

const logger = new ModuleLogger({ name: "cache" });

interface Record<K, V> {
  key: K;
  value: V;
}

export interface CacheRetrievalOptions<V> {
  /** Condition under which to ignore cache and retrieve resource */
  condition?: (v: V) => boolean;
  /** Ignore cache and force retrieval */
  force?: boolean;
  /** Combine cached and retrieved into result value */
  combine?: (cached: V, retrieved: V) => V;
}

export class GlobalCache {
  private lock: GlobalLock;
  bypass = false;

  private get objectsDir() {
    return join(this.directory, OBJ_DIR);
  }

  constructor(
    /** Directory to store cache in */
    private directory: string,
    private options?: {
      /** Cache name, will be used as logger instance */
      name?: string;
    },
  ) {
    this.lock = new GlobalLock(new InstanceLogger(this.options?.name, { parent: logger }));
    mkdirSync(this.objectsDir, { recursive: true });
  }

  async get<K, V>(key: K): Promise<V | undefined> {
    if (this.bypass) return undefined;
    const path = this.keyToPath(key);
    try {
      const buf = await this.withLock(async () => await readFile(path, { encoding: "utf8" }));
      const rec = JSON.parse(buf) as Record<K, V>;
      if (jsonStableStringify(rec.key) === jsonStableStringify(key)) return rec.value;
    } catch (err) {
      const error = err as object;
      if ("code" in error && error.code === "ENOENT") return undefined;
      throw err;
    }
    return undefined;
  }

  async set<K, V>(key: K, value: V) {
    const path = this.keyToPath(key);
    const rec: Record<K, V> = {
      key,
      value,
    };
    await this.withLock(async () => {
      await writeFile(path, jsonStableStringify(rec));
    });
  }

  async retrieve<K, V>(
    key: K,
    func: (cached: V | undefined) => Promise<V>,
    options?: CacheRetrievalOptions<V>,
  ): Promise<V> {
    const cached = (await this.get(key)) as V | undefined;
    if ((!cached || options?.force) ?? options?.condition?.(cached)) {
      let value: V = await func(cached);
      if (cached && options?.combine) value = options.combine(cached, value);
      await this.set(key, value);
      return value;
    }
    return cached;
  }

  async wipe() {
    await this.withLock(async () => {
      await emptyDir(this.objectsDir);
    });
  }

  private keyToPath(key: any): string {
    const hash = this.calcHash(key);
    return join(this.directory, OBJ_DIR, hash);
  }

  private calcHash(key: any): string {
    const hash = createHash("sha256");
    hash.update(typeof key === "string" ? key : jsonStableStringify(key));
    return hash.digest("hex");
  }

  async withLock<T>(f: () => Promise<T>): Promise<T> {
    return this.lock.with(this.directory, f);
  }

  // DEBUG: add command to wipe cache (for debugging)
}
