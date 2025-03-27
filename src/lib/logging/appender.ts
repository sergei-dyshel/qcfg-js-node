import { Console } from "node:console";
import { AsyncContext } from "../async-context";

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
    /**
     * If defined - pass to {@link Console} constructor. Otherwise determine automatically based on
     * whether stdout/stderr are TTY.
     */
    colorMode?: boolean;
  }) {
    if (options?.default) this.console = console;
    else {
      // Just passing `auto` to Console constructor may not work as underlying stdout/stderr streams
      // may be overriden by AsyncContext;
      const colorMode =
        options?.colorMode ?? (options?.allowStdout ? process.stdout : process.stderr).isTTY;

      this.console = new Console({
        stdout: options?.allowStdout ? AsyncContext.stdout : AsyncContext.stderr,
        stderr: AsyncContext.stderr,
        colorMode: colorMode,
      });
    }
  }
  append(logLine: string, args?: unknown[]) {
    args = args ?? [];
    this.console.log(logLine, ...args);
  }
}
