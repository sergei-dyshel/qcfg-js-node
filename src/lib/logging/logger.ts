import { getCallsite } from "../callsites";
import { LogLevel, type LogRecord } from "./core";
import { LogHandler, type LogHandlerOptions, type LogHandlerType } from "./handler";

export function registerLogHandler(handler: LogHandlerType) {
  handlers.push(handler);
}

export function getLogHandlers(): readonly LogHandlerType[] {
  return handlers;
}

export interface LoggingOptions {
  handler?: LogHandlerOptions;
}

export function configureLogging(options?: LoggingOptions) {
  handlers.splice(0);
  registerLogHandler(new LogHandler(options?.handler));
}

export interface LoggerOptions {
  parent?: Logger;
  level?: LogLevel;
  now?: () => Date;
}

export class Logger {
  readonly parent?: Logger;
  level?: LogLevel;

  constructor(private options?: LoggerOptions) {
    this.level = options?.level;
    this.parent = options?.parent;
  }

  log(level: LogLevel, message: string, ...args: unknown[]) {
    /** Skip frames for {@link log}, {@link logImpl} */
    this.logImpl(level, 2, message, args);
  }

  logCallDepth(level: LogLevel, callDepth: number, message: string, ...args: unknown[]) {
    this.logImpl(level, callDepth, message, args);
  }

  trace(message: string, ...args: unknown[]) {
    this.logWithLevel(LogLevel.TRACE, message, args);
  }

  debug(message: string, ...args: unknown[]) {
    this.logWithLevel(LogLevel.DEBUG, message, args);
  }

  info(message: string, ...args: unknown[]) {
    this.logWithLevel(LogLevel.INFO, message, args);
  }

  notice(message: string, ...args: unknown[]) {
    this.logWithLevel(LogLevel.NOTICE, message, args);
  }

  warn(message: string, ...args: unknown[]) {
    this.logWithLevel(LogLevel.WARNING, message, args);
  }

  error(message: string, ...args: unknown[]) {
    this.logWithLevel(LogLevel.ERROR, message, args);
  }

  fatal(message: string, ...args: unknown[]) {
    this.logWithLevel(LogLevel.FATAL, message, args);
  }

  // protected

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  augumentRecord(_: LogRecord) {}

  // private

  private logWithLevel(level: LogLevel, message: string, args: unknown[]) {
    // this function is called from debug, info etc.
    // so we need to skip frames for log function, logWithLevel, logImpl,
    this.logImpl(level, 3, message, args);
  }

  private logImpl(logLevel: LogLevel, callDepth: number, message: string, args: unknown[]) {
    if (this.level && logLevel < this.level) return;
    const record: LogRecord = {
      message,
      level: logLevel,
      date: this.options?.now?.() ?? new Date(),
      callSite: getCallsite(callDepth),
      args,
    };
    this.augumentRecord(record);
    for (const handler of handlers) handler.handle(record);
  }
}

const handlers: LogHandlerType[] = [];
