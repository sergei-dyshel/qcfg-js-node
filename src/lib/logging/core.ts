import { enumUtil } from "@sergei-dyshel/typescript/enum";
import type { CallSite } from "../callsites";

export enum LogLevel {
  TRACE = 1,
  DEBUG = 2,
  INFO = 3,
  NOTICE = 4,
  WARNING = 5,
  ERROR = 6,
  FATAL = 7,
}

export type LogLevelName = keyof typeof LogLevel;
export type LogLevelNameLowerCase = Lowercase<LogLevelName>;

export namespace LogLevels {
  export const util = enumUtil(LogLevel);

  export function toString(level: LogLevel) {
    return LogLevel[level] as LogLevelName;
  }

  export function toLowerCase(level: LogLevel) {
    return LogLevel[level].toLowerCase() as LogLevelNameLowerCase;
  }

  export function fromString(s: string): LogLevel | undefined {
    return LogLevel[s.toUpperCase() as LogLevelName];
  }

  export function strings() {
    return Object.keys(LogLevel) as LogLevelName[];
  }
}

export type LogInstance = string | (() => string);

export interface LogRecord {
  /** Timestamp */
  date: Date;
  /** Loglevel */
  level: LogLevel;
  /** Function name */
  callSite: CallSite;
  /** Library module */
  module?: string;
  /** Object instance ID/descriptor */
  instance?: string;
  /** Log message */
  message: string;
  /** Arguments */
  args: unknown[];
}
