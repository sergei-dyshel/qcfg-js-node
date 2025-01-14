import { LogLevel } from "./core";
import { type ErrorFormatOptions, Logger } from "./logger";

export class RootLogger extends Logger {
  protected constructor() {
    super();
  }

  private static theLogger = new RootLogger();
  static get() {
    return RootLogger.theLogger;
  }
}

export function log(level: LogLevel, message: string, ...args: unknown[]) {
  RootLogger.get().log(level, message, ...args);
}

export function trace(message: string, ...args: unknown[]) {
  log(LogLevel.TRACE, message, ...args);
}

export function debug(message: string, ...args: unknown[]) {
  log(LogLevel.DEBUG, message, ...args);
}

export function info(message: string, ...args: unknown[]) {
  log(LogLevel.INFO, message, ...args);
}

export function warn(message: string, ...args: unknown[]) {
  log(LogLevel.WARNING, message, ...args);
}

export function error(message: string, ...args: unknown[]) {
  log(LogLevel.ERROR, message, ...args);
}

export function fatal(message: string, ...args: unknown[]) {
  log(LogLevel.FATAL, message, ...args);
}

export function logError(error: unknown, options?: ErrorFormatOptions) {
  RootLogger.get().logError(error, options);
}
