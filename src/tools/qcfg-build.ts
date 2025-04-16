import { jsoncParser } from "@sergei-dyshel/typescript";
import { filterAsync, mapAsync } from "@sergei-dyshel/typescript/array";
import { assert, assertNotNull } from "@sergei-dyshel/typescript/error";
import * as esbuild from "esbuild";
import { writeFileSync } from "node:fs";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { waitForever } from "../lib/async";
import { exists, isDirectorySync, isFileSync } from "../lib/filesystem";
import { LogLevel, RootLogger } from "../lib/logging";
import {
  allOclifCommands,
  Args,
  argsInput,
  BaseCommandWithVerbosity,
  command,
  CommandArgs,
  CommandFlags,
  Flags,
  flagsInput,
  helpGroup,
  OclifHelp,
  restArgs,
  runCli,
} from "../lib/oclif";
import { relPath, stripExt } from "../lib/path";
import { shlex } from "../lib/shlex";
import { run } from "../lib/subprocess";
export { allOclifCommands, OclifHelp };

const SRC_DIR = "src";
const OUT_DIR = "dist";
const DEFAULT_MAIN_FILE = "main.ts";

const logger = RootLogger.get();

abstract class RootCommand extends BaseCommandWithVerbosity {
  static override baseFlags = flagsInput({
    ...BaseCommandWithVerbosity.baseFlags,
    cwd: Flags.string({
      description: "Directory in which to build (defaults to current directory)",
      char: "c",
      default: () => Promise.resolve(process.cwd()),
    }),
    ...helpGroup("BUILD", {
      tsconfig: Flags.string({
        description: "Path to tsconfig.json file (defaults to tsconfig.json in current directory)",
        char: "t",
      }),
      vscodeMock: Flags.boolean({
        description: "Build executable with VSCode mock module",
        default: false,
        exclusive: ["vscode-ext"],
      }),
    }),
  });
}

abstract class BaseBuildCommand extends RootCommand {
  declare flags: CommandFlags<typeof BaseBuildCommand>;
  declare args: CommandArgs<typeof BaseBuildCommand>;

  protected targets!: Target[];

  static override baseFlags = flagsInput({
    ...super.baseFlags,
    dry: Flags.boolean({
      description: "Do not overwrite build artifacts",
      char: "n",
      default: true,
    }),
    ...helpGroup("BUILD", {
      vscodeExt: Flags.boolean({
        description: "Build VSCode extension",
        default: false,
        exclusive: ["vscode-mock"],
      }),
    }),
  });

  public override async init() {
    await super.init();

    this.targets = this.argv.map(
      (entrypoint) =>
        new Target(entrypoint, {
          ...this.flags,
          addJs: this.flags.vscodeExt,
          executable: !this.flags.vscodeExt,
        }),
    );
  }
}

@command("build")
export class BuildCommand extends BaseBuildCommand {
  declare flags: CommandFlags<typeof BuildCommand>;
  declare args: CommandArgs<typeof BuildCommand>;

  static override summary = "Build target(s)";
  static override strict = false;
  static override aliases = ["b"];

  static override flags = flagsInput({
    analyze: Flags.boolean({
      description: "Analyze metafile",
      char: "a",
      default: false,
    }),
    force: Flags.boolean({
      description: "Force rebuild even if none of dependencies changed",
      char: "f",
    }),
  });

  static override args = argsInput({
    targets: Args.string({
      description: "Target(s) to build",
      required: true,
    }),
  });

  override async run() {
    const targetsToBuild = this.flags.force
      ? this.targets
      : await filterAsync(this.targets, (target) => target.shouldRebuild());
    const context = await createEsbuildContext(targetsToBuild, {
      ...this.flags,
      verbose: this.verbose > 1,
      /** Log level of the message about target being rebuilt */
      rebuildLogLevel: this.flags.force ? LogLevel.INFO : LogLevel.WARNING,
    });
    await context.rebuild();
    await context.dispose();
  }
}

@command("watch")
export class WatchCommand extends BaseBuildCommand {
  declare flags: CommandFlags<typeof WatchCommand>;
  declare args: CommandArgs<typeof WatchCommand>;

  static override summary = "Watch and rebuild target(s)";
  static override strict = false;
  static override aliases = ["w"];

  static override flags = flagsInput({});

  static override args = argsInput({
    targets: Args.string({
      description: "Target(s) to watch",
      required: true,
    }),
  });

  override async run() {
    const context = await createEsbuildContext(this.targets, {
      ...this.flags,
      analyze: false,
      verbose: this.verbose > 1,
      rebuildLogLevel: LogLevel.INFO,
      watch: true,
    });
    await context.watch();
    await waitForever();
  }
}

@command("run")
export class RunCommand extends RootCommand {
  declare flags: CommandFlags<typeof RunCommand>;
  declare args: CommandArgs<typeof RunCommand>;

  static override summary = "Build and run target";
  static override aliases = ["r"];

  static override flags = flagsInput({
    ifBuilt: Flags.boolean({
      description: "Only run if target was rebuilt",
    }),
    debug: Flags.boolean({
      description: "Run in debug mode (--inspect-brk)",
      char: "d",
    }),
  });

  static override args = argsInput({
    target: Args.string({
      description: "Target to build and run",
      required: true,
    }),
    ...restArgs({ description: "Run parameters", name: "PARAMS" }),
  });

  override async run() {
    const target = new Target(this.args.target, {
      addJs: false,
      executable: true,
      ...this.flags,
    });
    if (this.flags.ifBuilt && !(await target.shouldRebuild())) {
      logger.warn(`'${target.out}' is up to date, not running`);
      return;
    }

    const context = await createEsbuildContext([target], {
      ...this.flags,
      analyze: false,
      verbose: this.verbose > 1,
      rebuildLogLevel: LogLevel.INFO,
      dry: false,
      vscodeExt: false,
    });
    await context.rebuild();
    await context.dispose();

    const cmd = ["node", ...getRunNodeArgs(this.flags)];
    if (this.flags.debug) cmd.push("--inspect-brk");
    const fullCmd = [...cmd, target.out, ...this.argv];
    logger.info("Running: ", shlex.join(fullCmd));
    const result = await run(fullCmd);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    process.exit(result.exitCode!);
  }
}

class Target {
  /** Original entrypoint file name */
  entrypoint: string;

  /** Output filename without '.js' extension (will be appended later if needed) */
  outNoExt: string;

  /** Esbuild generates sourcemap with source paths relative to this dir */
  sourceRoot: string;

  constructor(
    src: string,
    private readonly options: {
      /** Add .js extension */
      addJs: boolean;
      /** Make file executable */
      executable: boolean;
      cwd: string;
    },
  ) {
    this.entrypoint = isDirectorySync(src) ? join(src, DEFAULT_MAIN_FILE) : src;
    assert(isFileSync(this.entrypoint), `Entry point ${this.entrypoint} does not exist`);

    // path of source file relative to base (src) directory
    const srcRelPath = relative(SRC_DIR, this.entrypoint);
    assert(!srcRelPath.startsWith(".."), `Entry point ${this.entrypoint} is not in src directory`);

    // path of output file
    const outPath = relative(process.cwd(), join(options.cwd, OUT_DIR, srcRelPath));

    // this is the directory where esbuild would write files if it was given "write: true"
    this.sourceRoot = dirname(join(options.cwd, OUT_DIR, srcRelPath));

    this.outNoExt =
      basename(this.entrypoint) === DEFAULT_MAIN_FILE ? dirname(outPath) : stripExt(outPath);
  }

  get out() {
    return this.options.addJs ? this.outNoExt + ".js" : this.outNoExt;
  }

  async shouldRebuild() {
    const buildScriptStats = await stat(process.argv[1]);
    const buildScriptTs = buildScriptStats.mtimeMs;

    if (!(await exists(this.out))) {
      logger.debug(`'${this.out}' does not exist, rebuild needed`);
      return true;
    }

    const metafileName = this.outNoExt + ".metafile.json";
    if (!(await exists(metafileName))) {
      logger.debug(`${metafileName} does not exist, must rebuild`);
      return true;
    }

    const metafile = JSON.parse(await readFile(metafileName, "utf8")) as esbuild.Metafile;
    const timestamps = await getInputTimestamps(Object.keys(metafile.inputs));
    const anyDeleted = timestamps.some((ts) => ts.deleted);
    if (anyDeleted) {
      logger.debug(`Some inputs of ${this.out} were deleted, rebuilding`);
      return true;
    }

    const stats = await stat(this.out);
    const entryTs = stats.mtimeMs;
    let shouldRebuild = false;
    if (buildScriptTs > entryTs) {
      logger.debug(`${this.out} is older than build script, rebuilding`);
      return true;
    } else {
      shouldRebuild = timestamps.some((ts) => {
        if (ts.timestampMs! > entryTs) {
          logger.debug(`${this.out} is older than its dependency ${ts.input}, rebuilding`);
          return true;
        }
        return false;
      });
    }
    if (shouldRebuild) return true;

    logger.debug(`${this.out} is up to date`);
    return false;
  }

  async write(
    metafile: esbuild.Metafile,
    bundle: esbuild.OutputFile,
    sourceMap: esbuild.OutputFile,
    logLevel: LogLevel,
  ) {
    await mkdir(dirname(this.out), { recursive: true });

    const expectedSourceMapAnnotation =
      "//# sourceMappingURL=" + stripExt(basename(this.entrypoint)) + ".js.map";
    let bundleText = bundle.text;
    assert(bundleText.includes(expectedSourceMapAnnotation));
    bundleText = bundleText.replace(
      expectedSourceMapAnnotation,
      "//# sourceMappingURL=" + basename(this.outNoExt) + ".js.map",
    );
    await writeFile(this.out, bundleText);
    if (this.options.executable) {
      await chmod(this.out, 0o755);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const sourceMapJson = JSON.parse(sourceMap.text);

    // rebase source paths to actual dir of written source map file
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    sourceMapJson.sources = sourceMapJson.sources.map((path: string) => {
      const absPath = join(this.sourceRoot, path);
      return relPath(dirname(this.out), absPath);
    });
    await writeFile(this.outNoExt + ".js.map", JSON.stringify(sourceMapJson));

    const metafileName = this.outNoExt + ".metafile.json";
    writeFileSync(metafileName, JSON.stringify(metafile, null, 2));

    logger.log(logLevel, `Built ${this.out}`);
  }
}

function getRunNodeArgs(options: { vscodeMock: boolean }) {
  const nodeArgs = ["--enable-source-maps"];
  if (options.vscodeMock) {
    // ts-node is needed to compile vscode mock TS files on the fly
    nodeArgs.push("-r", "@sergei-dyshel/vscode/mock-register", "-r", "ts-node/register");
  }
  return nodeArgs;
}

async function createEsbuildContext(
  targets: Target[],
  options: {
    vscodeExt: boolean;
    vscodeMock: boolean;
    tsconfig?: string;
    cwd: string;
    analyze: boolean;
    verbose: boolean;
    watch?: boolean;
    dry: boolean;
    rebuildLogLevel: LogLevel;
  },
) {
  const nodeArgs = getRunNodeArgs(options);
  const nodeArgsStr = nodeArgs.join(" ");
  // see https://sambal.org/2014/02/passing-options-node-shebang-line/
  const nodeShebang = `#!/bin/bash\n":" //# comment; exec /usr/bin/env node ${nodeArgsStr} \${INSPECT:+--inspect} \${INSPECT_BRK:+--inspect-brk} "$0" "$@"`;

  const external = [
    "esbuild",
    // required but not used by `http-cookie-agent` used by `NodeJS-midway`
    "deasync",
    // oclif inflates bundle by 10MB of typescript, which it doesn't use
    "typescript",
  ];

  const tsconfigRaw = await getRawTsconfig(options.cwd, options.tsconfig);
  const tsconfig = tsconfigRaw ? undefined : options.tsconfig;

  if (options.vscodeExt || options.vscodeMock) external.push("vscode");

  const esbuildOptions: esbuild.BuildOptions = {
    absWorkingDir: options.cwd,
    entryPoints: targets.map((t) => t.entrypoint),
    write: false,
    // files are not realy written there
    outdir: OUT_DIR,
    outbase: SRC_DIR,
    entryNames: "[dir]/[name]",
    banner: options.vscodeExt
      ? undefined
      : {
          js: nodeShebang,
        },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "es2023",
    // inline sourcemaps do not work well with remote debugging
    sourcemap: "linked",
    external,
    tsconfig,
    tsconfigRaw,
    // preserve function and classes names so not to break reflection
    keepNames: true,
    metafile: true,
    minify: options.analyze,
    lineLimit: 100,
    color: true,
    logLevel: options.verbose ? "info" : "warning",
    plugins: [
      {
        name: "umd2esm",
        setup(build) {
          // https://github.com/evanw/esbuild/issues/1619
          // https://github.com/microsoft/node-jsonc-parser/issues/57
          build.onResolve({ filter: /^jsonc-parser/ }, (args) => {
            const pathUmdMay = require.resolve(args.path, {
              paths: [args.resolveDir],
            });
            // Call twice the replace is to solve the problem of the path in Windows
            const pathEsm = pathUmdMay.replace("/umd/", "/esm/").replace("\\umd\\", "\\esm\\");
            return { path: pathEsm };
          });
        },
      },
      {
        name: "qcfg-build",
        setup: (build) => {
          build.onStart(() => {
            if (options.watch) console.log("[watch] build started");
          });
          build.onEnd(async (result) => {
            if (result.errors.length > 0) {
              if (options.watch) logger.error("Build finished with errors");
              return;
            }
            if (options.watch) console.log("[watch] build finished");
            assertNotNull(result.metafile);
            assert(
              result.outputFiles!.length === targets.length * 2,
              "Unexpected number of output files (should be bundled file and source map for each entrypoing)",
            );
            await mapAsync(targets, (target, i) =>
              target.write(
                result.metafile!,
                result.outputFiles![2 * i + 1],
                result.outputFiles![2 * i],
                options.rebuildLogLevel,
              ),
            );

            if (options.analyze) {
              logger.info(await esbuild.analyzeMetafile(result.metafile, { color: true }));
            }
          });
        },
      },
    ],
  };

  return esbuild.context(esbuildOptions);
}
async function getInputTimestamps(inputs: string[]) {
  return Promise.all(
    inputs.map(async (input) => {
      try {
        const stats = await stat(input);
        const timestampMs = stats.mtimeMs;
        return { input, timestampMs, deleted: false };
      } catch (err) {
        // assuming file doesn't exist
        return { input, deleted: true };
      }
    }),
  );
}

async function getRawTsconfig(cwd: string, tsconfig?: string) {
  // if tsconfig.json extends another config esbuild sometimes doesn't expand it right and
  // some feature may not work as expected (for example configuring `baseUrl: ${configDir}`
  // in base config). If we detect extended config, we use tsc to recursively expand it
  // and feed it to esbuild as raw JSON.

  tsconfig = tsconfig ?? "tsconfig.json";
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const tsconfigJson = jsoncParser.parse(
    await readFile(join(cwd, tsconfig), "utf8"),
    undefined /* errors */,
    {
      allowTrailingComma: true,
    },
  );
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return tsconfigJson.extends
    ? (
        await run(["npx", "tsc", "--project", tsconfig, "--showConfig"], {
          cwd,
          stdout: "pipe",
        })
      ).stdout!
    : undefined;
}

void runCli(__filename, __dirname, {
  description: "Internal build tool",
});
