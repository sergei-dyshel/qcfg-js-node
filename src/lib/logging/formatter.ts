import { assignDefaults } from "@sergei-dyshel/typescript/object";
import { inspect } from "node:util";
import { LogLevels, type LogRecord } from ".";

export interface LogFormatterType {
  format: (_: LogRecord) => string;
}

export enum LogFormat {
  MSG = "msg",
  SHORT = "short",
  FULL = "full",
}

interface BaseLogFormatterOptions {
  showDate?: boolean;
  showLevel?: boolean;
  showLocation?: boolean;
  showFunction?: boolean;
  showModule?: boolean;
  showInstance?: boolean;
}

function logFormatOptions(format: LogFormat): BaseLogFormatterOptions {
  const options: BaseLogFormatterOptions = {};
  switch (format) {
    case LogFormat.FULL:
      options.showDate = true;
      options.showFunction = true;
    /* fallthrough */
    case LogFormat.SHORT:
      options.showLevel = true;
      options.showModule = true;
      options.showInstance = true;
    /* fallthrough */
    case LogFormat.MSG:
      break;
  }
  return options;
}

export interface LogFormatterOptions extends BaseLogFormatterOptions {
  format?: LogFormat;
  serializeArgs?: boolean;
  serialize?: (arg: unknown) => string;
}

export class LogFormatter implements LogFormatterType {
  private options: LogFormatterOptions;
  private serialize: (arg: unknown) => string;

  constructor(options?: LogFormatterOptions) {
    this.options = assignDefaults(
      options ?? {},
      logFormatOptions(options?.format ?? LogFormat.MSG),
    );

    this.serialize = options?.serialize ?? inspect;
  }

  format(record: LogRecord) {
    const parts: string[] = [];
    if (this.options.showDate) parts.push(this.formatDate(record.date));
    if (this.options.showLocation) {
      const { callSite } = record;
      const location = `${callSite.getFileName()}:${callSite.getLineNumber()}:${callSite.getColumnNumber()}`;
      parts.push(LogLevels.toString(record.level), location);
    }
    if (this.options.showFunction) parts.push(record.callSite.getFunctionName() + "()");
    if (this.options.showModule && record.module) parts.push(`[${record.module}]`);
    if (this.options.showInstance && record.instance) parts.push(`{${record.instance}}`);
    parts.push(record.message);
    if (this.options?.serializeArgs) parts.push(record.args.map(this.serialize).join(" "));
    return parts.join(" ");
  }

  formatDate(date: Date): string {
    const dateStr = date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const ms = String(date.getMilliseconds()).padStart(3, "0");
    return dateStr + "." + ms;
  }
}
