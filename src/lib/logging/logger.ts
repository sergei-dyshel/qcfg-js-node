import { getCallsites } from "../callsites";
import { LogLevel, LogRecord } from "./core";
import { LogHandler, LogHandlerOptions, LogHandlerType } from "./handler";

export function registerLogHandler(handler: LogHandlerType) {
  handlers.push(handler);
}

export interface LoggingOptions {
  handlerOptions?: LogHandlerOptions;
}

export function configureLogging(options?: LoggingOptions) {
  registerLogHandler(new LogHandler(options?.handlerOptions));
}

export interface LoggerOptions {
  parent?: Logger;
}

export class Logger {
  readonly parent?: Logger;

  constructor(options?: LoggerOptions) {
    this.parent = options?.parent;
  }

  log(level: LogLevel, message: string, ...args: unknown[]) {
    this.logImpl(level, 3, message, args);
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

  augumentRecord(_: LogRecord) {}

  // private

  private logWithLevel(level: LogLevel, message: string, args: unknown[]) {
    this.logImpl(level, 4, message, args);
  }

  private logImpl(logLevel: LogLevel, callDepth: number, message: string, args: unknown[]) {
    const record: LogRecord = {
      message,
      level: logLevel,
      date: new Date(),
      callSite: getCallsites()[callDepth],
      args,
    };
    this.augumentRecord(record);
    for (const handler of handlers) handler.handle(record);
  }
}

const handlers: LogHandlerType[] = [];
