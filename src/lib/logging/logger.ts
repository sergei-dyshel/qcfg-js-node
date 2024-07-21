import { formatError } from "@sergei-dyshel/typescript/error";
import {
  formatErrorStackFrame,
  getCallsite,
  parseErrorStack,
  type StackFrameFormatOptions,
} from "../callsites";
import { LogLevel, type LogRecord } from "./core";
import { LogHandler, type LogHandlerOptions, type LogHandlerType } from "./handler";

export function registerLogHandler(handler: LogHandlerType) {
  handlers.push(handler);
}

export function getLogHandlers(): readonly LogHandlerType[] {
  return handlers;
}

export function configureLogging(options?: { handler?: LogHandlerOptions }) {
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
    // Skip frames for log, logImpl
    this.logImpl(level, 1, message, args);
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

  warn(message: string, ...args: unknown[]) {
    this.logWithLevel(LogLevel.WARNING, message, args);
  }

  error(message: string, ...args: unknown[]) {
    this.logWithLevel(LogLevel.ERROR, message, args);
  }

  fatal(message: string, ...args: unknown[]) {
    this.logWithLevel(LogLevel.FATAL, message, args);
  }

  logError(
    error: unknown,
    options?: {
      /** Prefix error message with this string */
      prefix?: string;

      /** By default use ERROR */
      level?: LogLevel;

      /** Hide error class name */
      hideName?: boolean;

      stackFrameFormat?: StackFrameFormatOptions;
    },
  ) {
    let msg = (options?.prefix ?? "") + formatError(error, options);
    if (error instanceof Error && error.stack) {
      try {
        const filteredFrames = parseErrorStack(error.stack)
          .filter(
            (frame) =>
              !frame.file ||
              (!frame.file.startsWith("node:") &&
                !frame.file.includes("ts-node/src/index.ts") &&
                !frame.file.includes("/qcfg-js-typescript/src/error.ts") &&
                !frame.file.includes("extensionHostProcess.js")),
          )
          .map((frame) => formatErrorStackFrame(frame, options?.stackFrameFormat));
        msg += "\n" + filteredFrames.join("\n");
      } catch (err) {
        msg += `\n(Couldn not parse error stack trace: ${String(err)})\n${String(error.stack)}`;
      }
    }
    this.logImpl(options?.level ?? LogLevel.ERROR, 1, msg, []);
    if (error instanceof Error && error.cause)
      this.logError(error.cause, { ...options, prefix: "Caused by: " });
  }

  // protected

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected augumentRecord(_: LogRecord) {}

  // private

  private logWithLevel(level: LogLevel, message: string, args: unknown[]) {
    // this function is called from debug, info etc.
    // so we need to skip frames for log function, logWithLevel, logImpl,
    this.logImpl(level, 2, message, args);
  }

  private logImpl(logLevel: LogLevel, callDepth: number, message: string, args: unknown[]) {
    if (this.level && logLevel < this.level) return;
    const record: LogRecord = {
      message,
      level: logLevel,
      date: this.options?.now?.() ?? new Date(),
      callSite: getCallsite(1 + callDepth),
      args,
    };
    this.augumentRecord(record);
    for (const handler of handlers) handler.handle(record);
  }
}

const handlers: LogHandlerType[] = [];
