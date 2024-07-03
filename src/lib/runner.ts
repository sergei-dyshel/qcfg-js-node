import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { run, type Command, type RunOptions, type RunResult } from "./subprocess";

export type RunFunc<Options = RunOptions> = (
  command: Command,
  options?: Options,
) => Promise<RunResult>;

export class Runner<Options = RunOptions> {
  options: Options;
  constructor(
    protected runFunc: RunFunc<Options>,
    options?: Options,
  ) {
    this.options = options ?? ({} as Options);
  }

  mergeOptions(options: Options) {
    this.options = deepMerge(this.options, options);
  }

  run(command: Command, options?: Options) {
    const mergedOptions = deepMerge(this.options, options);
    return this.runFunc(command, mergedOptions);
  }
}

export class SubprocessRunner extends Runner {
  constructor(options?: RunOptions) {
    super(run, options);
  }
}
