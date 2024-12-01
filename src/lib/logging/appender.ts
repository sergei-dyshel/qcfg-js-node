import { Console } from "node:console";

export interface LogAppender {
  append: (logLine: string, args?: unknown[]) => void;
}

export class ConsoleAppender implements LogAppender {
  console: Console;

  constructor(options?: {
    /** Allow writing to stdout, otherwise will use stderr for all logging */
    allowStdout?: boolean;
  }) {
    this.console = new Console({
      stdout: options?.allowStdout ? process.stdout : process.stderr,
      stderr: process.stderr,
    });
  }
  append(logLine: string, args?: unknown[]) {
    args = args ?? [];
    // send to stderr
    this.console.log(logLine, ...args);
  }
}
