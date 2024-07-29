import { assert } from "@sergei-dyshel/typescript/error";
import * as cmd from "cmd-ts";
import * as esbuild from "esbuild";
import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { isDirectorySync } from "../../lib/filesystem";
import { LogLevel, RootLogger, configureLogging } from "../../lib/logging";
import { stripExt } from "../../lib/path";
import { shlex } from "../../lib/shlex";
import { run } from "../../lib/subprocess";

const OUT_BASE = "src";
const OUT_DIR = "dist";
const DEFAULT_MAIN_FILE = "main.ts";

const logger = RootLogger.get();

const argSpec = {
  files: cmd.restPositionals({
    type: cmd.string,
    displayName: "file",
    description: `Path to command main TS file or its directory (then ${DEFAULT_MAIN_FILE} filename is assumed). If --run is provided then all paramters after first one are passed as arguments.`,
  }),
  cwd: cmd.option({
    type: cmd.optional(cmd.string),
    long: "cwd",
    short: "c",
    description: "Directory in which to build (defaults to current directory)",
  }),
  analyze: cmd.flag({
    type: cmd.boolean,
    long: "analyze",
    short: "a",
    description: "Analyze metafile",
  }),
  noMetafile: cmd.flag({
    type: cmd.boolean,
    long: "no-metafile",
    short: "M",
    description: "Do not create or expect metafile",
  }),
  minify: cmd.flag({
    type: cmd.boolean,
    long: "minify",
    short: "m",
    description: "Minify",
  }),
  verbose: cmd.flag({
    type: cmd.boolean,
    long: "verbose",
    short: "v",
    description: "Verbose logging (currently does nothing)",
  }),
  quiet: cmd.flag({
    type: cmd.boolean,
    long: "quiet",
    short: "q",
    description: "Only log errors",
  }),
  run: cmd.flag({
    type: cmd.boolean,
    long: "run",
    short: "r",
    description: "Run command after building (only for single command)",
  }),
  runIfBuilt: cmd.flag({
    type: cmd.boolean,
    long: "run-if-built",
    description: "Like --run but only run if entry point was rebuilt",
  }),
  debug: cmd.flag({
    type: cmd.boolean,
    long: "debug",
    short: "d",
    description: "When used with --run, use debug mode (--inspect)",
  }),
  vscode_ext: cmd.flag({
    type: cmd.boolean,
    long: "vscode-ext",
    description: "Build VSCode extension, implies --no-exec",
  }),
  vscode_mock: cmd.flag({
    type: cmd.boolean,
    long: "vscode-mock",
    description: "Build with VSCode mock",
  }),
  noExec: cmd.flag({
    type: cmd.boolean,
    long: "no-exec",
    short: "E",
    description:
      "If not given, make command executable, strip .js extension, chmod and add shebang",
  }),
  tsconfig: cmd.option({
    type: cmd.optional(cmd.string),
    long: "tsconfig",
    short: "t",
    description: "Path to tsconfig.json file (defaults to tsconfig.json in current directory)",
  }),
} as const;

interface EntryPoint {
  src: string;
  out: string;
  hasMain: boolean;
}

async function getInputTimestamps(inputs: string[]) {
  return Promise.all(
    inputs.map(async (input) => {
      try {
        const stats = await stat(input);
        const timestampMs = Math.max(stats.mtimeMs, stats.ctimeMs);
        return { input, timestampMs, deleted: false };
      } catch (err) {
        // assuming file doesn't exist
        return { input, deleted: true };
      }
    }),
  );
}

const appCmd = cmd.command({
  name: basename(__filename),
  description: "Build commands and tools using esbuild bundler",
  args: argSpec,
  handler: async (args) => {
    configureLogging({
      handler: {
        level: args.quiet ? LogLevel.INFO : LogLevel.DEBUG,
      },
    });
    if (args.vscode_ext && args.vscode_mock)
      throw new Error("Must use only one of --vscode-ext or --vscode-mock");

    const shouldRun = args.run || args.runIfBuilt;
    const noExec = args.noExec || args.vscode_ext;
    if (shouldRun && noExec) throw new Error("Cannot run file without making it executable");
    const cwd = args.cwd ?? process.cwd();
    assert(args.files.length > 0, "No entry points specified!");
    const files = shouldRun ? [args.files[0]] : args.files;
    const entryPoints: EntryPoint[] = files.map((path) => {
      if (isDirectorySync(path)) path = join(path, DEFAULT_MAIN_FILE);
      assert(existsSync(path), `Entry point ${path} does not exist`);
      // path of source file relative to base (src) directory
      const srcRelPath = relative(OUT_BASE, path);
      // path of output file
      const outPath = relative(process.cwd(), join(cwd, OUT_DIR, srcRelPath));
      return {
        src: path,
        ...(basename(path) === DEFAULT_MAIN_FILE
          ? {
              out: dirname(outPath),
              hasMain: true,
            }
          : {
              out: stripExt(outPath),
              hasMain: false,
            }),
      };
    });

    const nodeArgs = ["--enable-source-maps"];
    if (args.vscode_mock) {
      // ts-node is needed to compile vscode mock TS files on the fly
      nodeArgs.push("-r", "@sergei-dyshel/vscode/mock-register", "-r", "ts-node/register");
    }
    const nodeArgsStr = nodeArgs.join(" ");
    // see https://sambal.org/2014/02/passing-options-node-shebang-line/
    const nodeShebang = `#!/bin/bash\n":" //# comment; exec /usr/bin/env node ${nodeArgsStr} \${INSPECT:+--inspect} \${INSPECT_BRK:+--inspect-brk} "$0" "$@"`;

    const runEsbuild = async (entryPoints: EntryPoint[], entryNames: string) => {
      if (entryPoints.length === 0) return [];

      let filteredEntryPoints = entryPoints;
      if (!args.noMetafile) {
        const buildScriptStats = await stat(process.argv[1]);
        const buildScriptTs = Math.max(buildScriptStats.mtimeMs, buildScriptStats.ctimeMs);

        filteredEntryPoints = [];
        for (const entry of entryPoints) {
          if (!existsSync(entry.out)) {
            logger.debug(`'${entry.out}' does not exist, building`);
            filteredEntryPoints.push(entry);
            continue;
          }

          const metafileName = entry.out + ".metafile.json";
          if (!existsSync(metafileName)) {
            logger.debug(`${metafileName} does not exist, building`);
            filteredEntryPoints.push(entry);
            continue;
          }

          const metafile = JSON.parse(readFileSync(metafileName, "utf8")) as esbuild.Metafile;
          const timestamps = await getInputTimestamps(Object.keys(metafile.inputs));
          const anyDeleted = timestamps.some((ts) => ts.deleted);
          if (anyDeleted) {
            logger.debug(`Some inputs of ${entry.out} were deleted, rebuilding`);
            filteredEntryPoints.push(entry);
            continue;
          }

          const stats = statSync(entry.out);
          const entryTs = Math.max(stats.mtimeMs, stats.ctimeMs);
          let shouldRebuild = false;
          if (buildScriptTs > entryTs) {
            logger.debug(`${entry.out} is older than build script, rebuilding`);
            shouldRebuild = true;
          } else {
            shouldRebuild = timestamps.some((ts) => {
              if (ts.timestampMs! > entryTs) {
                logger.debug(`${entry.out} is older than its dependency ${ts.input}, rebuilding`);
                return true;
              }
              return false;
            });
          }
          if (shouldRebuild) {
            filteredEntryPoints.push(entry);
          } else {
            logger.debug(`${entry.out} is up to date`);
          }
        }
      }

      const external = [
        "esbuild",
        // required but not used by `http-cookie-agent` used by `NodeJS-midway`
        "deasync",
      ];
      if (args.vscode_ext || args.vscode_mock) external.push("vscode");
      const options: esbuild.BuildOptions = {
        absWorkingDir: cwd,
        entryPoints: filteredEntryPoints.map((e) => e.src),
        outdir: OUT_DIR,
        outbase: OUT_BASE,
        entryNames,
        banner: noExec
          ? undefined
          : {
              js: nodeShebang,
            },
        bundle: true,
        format: "cjs",
        platform: "node",
        target: "es2023",
        sourcemap: noExec ? "linked" : "inline",
        external,
        tsconfig: args.tsconfig,
        // preserve function and classes names so not to break reflection
        keepNames: true,
        metafile: !args.noMetafile,
        minify: args.analyze,
        lineLimit: 100,
        color: true,
        logLevel: args.verbose ? "info" : "warning",
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
        ],
      };
      if (filteredEntryPoints.length > 0) {
        const entryPointsStr = filteredEntryPoints.map((e) => e.src).join(", ");
        logger.debug(`Building ${entryPointsStr}`);
        const result = await esbuild.build(options);

        if (result.metafile) {
          if (args.analyze) {
            logger.info(await esbuild.analyzeMetafile(result.metafile, { color: true }));
          }
          for (const entry of filteredEntryPoints) {
            const metafileName = entry.out + ".metafile.json";
            logger.debug(`Writing metafile to ${metafileName}`);
            writeFileSync(metafileName, JSON.stringify(result.metafile, null, 2));
          }
        }
      }

      return filteredEntryPoints;
    };

    // esbuild doesn't support different entry name templates in one job so we must split into two jobs
    const filteredWithMain = await runEsbuild(
      entryPoints.filter((e) => e.hasMain),
      "[dir]",
    );
    const filteredWithoutMain = await runEsbuild(
      entryPoints.filter((e) => !e.hasMain),
      "[dir]/[name]",
    );

    const filteredEntryPoints = [...filteredWithMain, ...filteredWithoutMain];

    if (!noExec) {
      for (const entrypoint of filteredEntryPoints) {
        const out = entrypoint.out;
        renameSync(out + ".js", out);
        chmodSync(out, 0o775);
      }
    }

    if (shouldRun && (!args.runIfBuilt || filteredEntryPoints.length > 0)) {
      const cmd = ["node", ...nodeArgs];
      if (args.debug) cmd.push("--inspect-brk");
      const fullCmd = [...cmd, entryPoints[0].out, ...args.files.slice(1)];
      logger.info("Running: ", shlex.join(fullCmd));
      const result = await run(fullCmd);
      process.exit(result.exitCode!);
    }
  },
});

void cmd.run(appCmd, process.argv.slice(2));
