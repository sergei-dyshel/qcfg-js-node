import { getCallsite } from "../callsites";
import { basename } from "../path";
import type { LogRecord } from "./core";
import { Logger, type LoggerOptions } from "./logger";
import { RootLogger } from "./root";

export interface InstanceLoggerOptions extends LoggerOptions {
  parent?: ModuleLogger | RootLogger;
}

export interface ModuleLoggerOptions extends LoggerOptions {
  /** Module name, by default will use filename from where constructor is called */
  name?: string;

  /** Logger of parent module, for creating hierarchy. */
  parent?: ModuleLogger;
}

export class InstanceLogger extends Logger {
  declare readonly parent: ModuleLogger;

  constructor(
    public readonly instance?: string,
    options?: InstanceLoggerOptions,
  ) {
    super(options);
  }

  override augumentRecord(record: LogRecord) {
    if (this.parent instanceof ModuleLogger) {
      this.parent.augumentRecord(record);
    }
    record.instance = this.instance;
  }
}
export class ModuleLogger extends Logger {
  readonly path: string;
  readonly name: string;

  declare readonly parent: ModuleLogger | RootLogger;

  constructor(options?: ModuleLoggerOptions) {
    super({ ...options, parent: options?.parent ?? RootLogger.get() });
    this.name = options?.name ?? basename(getCallsite(1).file, true /* stripExt */);
    this.path =
      this.parent instanceof ModuleLogger ? this.parent.path + "." + this.name : this.name;
  }

  override augumentRecord(record: LogRecord) {
    record.module = this.path;
  }
}

export class MainLogger extends ModuleLogger {}
