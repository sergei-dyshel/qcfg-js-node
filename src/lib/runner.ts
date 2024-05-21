import { LogLevel, Logger } from "./logging";
import { Command, RunOptions, mergeRunOptions, run, shlexJoin } from "./subprocess";

const DEFAULT_PREFIX = "+ ";
const DEFAULT_LOG_LEVEL = LogLevel.DEBUG;

export interface RunnerLogOptions {
  logger?: Logger;
  logLevel?: LogLevel;
  /** Prefix to prepend to logged command line, by default `+` */
  prefix?: string;
}

export interface RunnerOptions extends RunOptions {
  log?: RunnerLogOptions;
}

export class Runner {
  options: RunnerOptions;

  constructor(options?: RunOptions) {
    this.options = options ?? {};
  }

  mergeOptions(options: RunOptions) {
    this.options = mergeRunOptions(this.options, options);
  }

  run(command: Command, options?: RunOptions) {
    this.log(command);
    return run(command, mergeRunOptions(this.options, options));
  }

  private log(command: Command) {
    const logOptions = this.options.log ?? {};
    if (!logOptions.logger) return;
    const prefix = logOptions.prefix ?? DEFAULT_PREFIX;
    const logLevel = logOptions.logLevel ?? DEFAULT_LOG_LEVEL;
    logOptions.logger.log(logLevel, prefix + shlexJoin(command));
  }
}
