export interface LogAppender {
  append: (logLine: string, args?: unknown[]) => void;
}

export class ConsoleAppender implements LogAppender {
  append(logLine: string, args?: unknown[]) {
    args = args ?? [];
    // send to stderr
    console.log(logLine, ...args);
  }
}
