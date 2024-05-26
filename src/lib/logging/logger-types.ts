import type { LogRecord } from "./core";
import { Logger, type LoggerOptions } from "./logger";
import { RootLogger } from "./root";

export interface InstanceLoggerOptions extends ModuleLoggerOptions {}
export interface ModuleLoggerOptions extends LoggerOptions {
  parent?: ModuleLogger;
}

export class InstanceLogger extends Logger {
  declare readonly parent: ModuleLogger;

  constructor(
    public readonly instance: string,
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
  declare readonly parent: ModuleLogger | RootLogger;
  constructor(
    readonly name: string,
    options?: ModuleLoggerOptions,
  ) {
    super({ parent: options?.parent ?? RootLogger.get() });
    this.path = this.parent instanceof ModuleLogger ? this.parent.path + "." + name : name;
  }

  override augumentRecord(record: LogRecord) {
    record.module = this.path;
  }
}

export class MainLogger extends ModuleLogger {
  constructor(filename: string) {
    super(filename);
  }
}
