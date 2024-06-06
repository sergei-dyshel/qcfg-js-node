import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { LogLevel, type Logger } from "./logging";
import { run, shlexJoin, type Command, type RunOptions } from "./subprocess";

const DEFAULT_PREFIX = "+ ";
const DEFAULT_LOG_LEVEL = LogLevel.DEBUG;

export interface RunnerLogOptions {
  /** Logging occurs only if this flag is set */
  shouldLog?: boolean;

  /** Logger to use, if not defined logging won't happen */
  logger?: Logger;

  /** Log level, by default {@link DEFAULT_LOG_LEVEL} */
  logLevel?: LogLevel;

  /** Prefix to prepend to logged command line, by default {@link DEFAULT_PREFIX} */
  prefix?: string;
}

export interface RunnerOptions extends RunOptions {
  log?: RunnerLogOptions;
}

export class Runner {
  options: RunnerOptions;

  constructor(options?: RunnerOptions) {
    this.options = options ?? {};
  }

  mergeOptions(options: RunnerOptions) {
    this.options = deepMerge(this.options, options);
  }

  run(command: Command, options?: RunnerOptions) {
    const mergedOptions = deepMerge(this.options, options);
    this.log(command, mergedOptions);
    return run(command, mergedOptions);
  }

  private log(command: Command, options: RunnerOptions) {
    const logOptions = options.log ?? {};
    if (!logOptions.logger || !logOptions.shouldLog) return;
    const prefix = logOptions.prefix ?? DEFAULT_PREFIX;
    const logLevel = logOptions.logLevel ?? DEFAULT_LOG_LEVEL;
    logOptions.logger.log(logLevel, prefix + shlexJoin(command));
  }
}
