import { LogFormatter, LogLevel } from ".";
import { ConsoleAppender, LogAppender } from "./appender";
import { LogRecord } from "./core";
import { LogFormatterType } from "./formatter";

export interface LogHandlerType {
  handle: (record: LogRecord) => void;
}

type LogFilter = (record: LogRecord) => boolean;

export interface BaseLogHandlerOptions {
  level?: LogLevel;
}

/** Minimal handler interface, with level filter and user-customizable filters */
export abstract class BaseLogHandler implements LogHandlerType {
  protected constructor(options?: BaseLogHandlerOptions) {
    const level = options?.level;
    if (level) this.filters.push((record) => record.level >= level);
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
  formatter?: LogFormatterType;
  appenders?: LogAppender[];
}

export class LogHandler extends BaseLogHandler {
  private formatter: LogFormatterType;
  private appenders: LogAppender[];

  constructor(private options?: LogHandlerOptions) {
    super(options);
    this.formatter = options?.formatter ?? new LogFormatter();
    this.appenders = options?.appenders ?? [new ConsoleAppender()];
  }

  override handle(record: LogRecord) {
    if (!this.shouldHandle(record)) return;
    const logLine = this.formatter.format(record);
    for (const appender of this.appenders)
      appender.append(logLine, this.options?.dropArgs ? undefined : record.args);
  }
}
