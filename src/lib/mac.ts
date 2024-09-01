import * as Cmd from "./cmdline-builder";
import { type RunOptions, run } from "./subprocess";

const openSchema = Cmd.schema({
  // Opens with the specified application.
  app: Cmd.string({ custom: "-a" }),
  // Opens with the specified application bundle identifier.
  bundle: Cmd.string({ custom: "-b" }),
  // Blocks until the used applications are closed (even if they were already running).
  waitApps: Cmd.boolean(),
  // Open a new instance of the application even if one is already running.
  new: Cmd.boolean(),
  // Launches the app hidden.
  hide: Cmd.boolean(),
  // Does not bring the application to the foreground.
  background: Cmd.boolean(),
  // Open this URL, even if it matches exactly a filepath.
  url: Cmd.string(),
});

export async function open(options: Cmd.Data<typeof openSchema>, runOptions?: RunOptions) {
  const cmd = ["open", ...Cmd.build(openSchema, options)];
  return run(cmd, runOptions);
}
