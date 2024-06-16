import { callIfDefined } from "@sergei-dyshel/typescript";
import { formatDate } from "@sergei-dyshel/typescript/datetime";
import { basename } from "node:path";
import { inspect } from "node:util";
import { LogLevels, type LogLevelNameLowerCase, type LogRecord } from ".";
import type { ColorizeFunction } from "../ansi-color";
import { shortenSourcePath } from "../callsites";

export interface LogFormatterType {
  format: (_: LogRecord) => readonly [string, unknown[]];
}

export type LogLineComponent = (record: LogRecord, format?: LogFormatOptions) => string;

/** Helpers for customizing log format */
export namespace LogFormat {
  //
  // log components
  //

  export const date: LogLineComponent = (record, format) => {
    // using Unicode tokens https://www.unicode.org/reports/tr35/tr35-dates.html#Date_Field_Symbol_Table
    let formatStr = "HH:mm:ss";
    if (!format?.date?.omitDate) formatStr = "yyyy-MM-dd " + formatStr;
    if (format?.date?.showMilliseconds) formatStr += ".SSS";

    return formatDate(record.date, formatStr);
  };
  export const level: LogLineComponent = (record, format) => {
    const str = LogLevels.toString(record.level);
    const options = format?.level?.[LogLevels.toLowerCase(record.level)];
    return callIfDefined(options?.colorizeLevel, str as string);
  };
  export const location: LogLineComponent = (record, format) => {
    const options = format?.location;
    const fullPath = record.callSite.file;
    const baseName = basename(fullPath);
    let filename = options?.relativePath ? shortenSourcePath(fullPath) : baseName;
    if (options?.fileColor) filename = options.fileColor(filename);
    let base = `${filename}:${record.callSite.line}`;
    if (options?.showColumn) base += `:${record.callSite.column}`;
    return base;
  };
  export const func: LogLineComponent = (record) => record.callSite.function + "()";
  export const message: LogLineComponent = (record) => record.message;
  export const module: LogLineComponent = (record) =>
    record.module && record.module != "" ? `[${record.module}]` : "";
  export const instance: LogLineComponent = (record) =>
    record.instance ? `{${record.instance}}` : "";

  //
  // Predefined templates
  //

  /** Only message, default template */
  export const MSG_ONLY: LogFormatTemplate = [message];

  /** Omit location data */
  export const SHORT = [level, module, instance, message];

  /** Full log line, including all components */
  export const FULL = [date, level, location, func, module, instance, message];
}

export interface LogFormatOptions {
  date?: {
    omitDate?: boolean;
    showMilliseconds?: boolean;
  };
  location?: {
    /** Show column number beside line number */
    showColumn?: boolean;

    /**
     * If set, log line will show path relative to library root. Otherwise only base file name will
     * be shown.
     */
    relativePath?: boolean;

    /** Color to apply to source file path */
    fileColor?: ColorizeFunction;
  };

  /** Override options per log level */
  level?: Partial<
    Record<
      LogLevelNameLowerCase,
      {
        colorizeLevel?: ColorizeFunction;
        colorizeLine?: ColorizeFunction;
      }
    >
  >;
}

type LogFormatTemplate = (LogLineComponent | string)[];

export interface LogFormatterOptions {
  /** Format of specific log line components */
  format?: LogFormatOptions;

  /**
   * Log line template that specifies which components to use.
   *
   * One should normally only use string literals and pre-made components from {@link LogFormat}.
   */
  template?: LogFormatTemplate;

  /**
   * Serialize arguments to end of log line, should be used for text-only appenders.
   *
   * Use {@link serialize} to custom conversion to string.
   */
  serializeArgs?: boolean;

  /**
   * Custom function to convert arguments to string.
   *
   * By default {@link inspect} is used.
   */
  serialize?: (arg: unknown) => string;
}

export class LogFormatter implements LogFormatterType {
  private serialize: (arg: unknown) => string;

  constructor(public options?: LogFormatterOptions) {
    this.serialize = options?.serialize ?? inspect;
  }

  format(record: LogRecord) {
    const parts: string[] = [];
    for (const component of this.options?.template ?? LogFormat.MSG_ONLY) {
      const part =
        typeof component === "string" ? component : component(record, this.options?.format);
      if (part !== "") parts.push(part);
    }
    if (this.options?.serializeArgs) parts.push(record.args.map(this.serialize).join(" "));
    const logLine = callIfDefined(
      this.options?.format?.level?.[LogLevels.toLowerCase(record.level)]?.colorizeLine,
      parts.join(" "),
    );
    return [logLine, this.options?.serializeArgs ? [] : record.args] as const;
  }
}
