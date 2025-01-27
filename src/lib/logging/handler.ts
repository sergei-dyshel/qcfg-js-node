import { ConsoleAppender, type LogAppender } from "./appender";
import type { LogLevel, LogRecord } from "./core";
import { LogFormatter, type LogFormatterOptions, type LogFormatterType } from "./formatter";

export interface LogHandlerType {
  level?: LogLevel;
  handle: (record: LogRecord) => void;
}

type LogFilter = (record: LogRecord) => boolean;

export interface BaseLogHandlerOptions {
  level?: LogLevel;
}

/** Minimal handler interface, with level filter and user-customizable filters */
export abstract class BaseLogHandler implements LogHandlerType {
  level?: LogLevel;

  protected constructor(options?: BaseLogHandlerOptions) {
    this.level = options?.level;
    this.filters.push((record) => this.level == undefined || record.level >= this.level);
  }

  abstract handle(record: LogRecord): void;

  protected shouldHandle(record: LogRecord): boolean {
    for (const filter of this.filters) if (!filter(record)) return false;
    return true;
  }

  protected filters: LogFilter[] = [];
}

export interface LogHandlerOptions extends BaseLogHandlerOptions {
  dropArgs?: boolean;
  formatter?: LogFormatterOptions;
  appenders?: LogAppender[];
}

export class LogHandler extends BaseLogHandler {
  readonly formatter: LogFormatterType;
  readonly appenders: LogAppender[];

  constructor(options?: LogHandlerOptions) {
    super(options);
    this.formatter = new LogFormatter(options?.formatter);
    this.appenders = options?.appenders ?? [new ConsoleAppender()];
  }

  override handle(record: LogRecord) {
    if (!this.shouldHandle(record)) return;
    const [logLine, args] = this.formatter.format(record);
    for (const appender of this.appenders) appender.append(logLine, args);
  }
}
