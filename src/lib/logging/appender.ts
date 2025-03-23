import { Console } from "node:console";

export interface LogAppender {
  append: (logLine: string, args?: unknown[]) => void;
}

export class ConsoleAppender implements LogAppender {
  console: Console;

  constructor(options?: {
    /**
     * Use default global console object, otherwise create a new console
     *
     * NOTE: need to use that for proper object dumps to DevTools console
     */
    default?: boolean;
    /**
     * Allow writing to stdout, otherwise will use stderr for all logging. Only used when `default`
     * is false.
     */
    allowStdout?: boolean;
  }) {
    if (options?.default) this.console = console;
    else
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
