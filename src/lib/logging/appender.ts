export interface LogAppender {
  append: (logLine: string, args?: unknown[]) => void;
}

export class ConsoleAppender implements LogAppender {
  console: Console;

  constructor(stream: NodeJS.WriteStream = process.stderr) {
    this.console = new console.Console({
      stdout: stream,
      stderr: stream,
    });
  }
  append(logLine: string, args?: unknown[]) {
    args = args ?? [];
    // send to stderr
    this.console.log(logLine, ...args);
  }
}
