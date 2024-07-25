import { assert } from "@sergei-dyshel/typescript/error";
import * as cmd from "cmd-ts";
import * as esbuild from "esbuild";
import { chmodSync, existsSync, renameSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { isDirectorySync } from "../../lib/filesystem";
import { RootLogger, configureLogging } from "../../lib/logging";
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
    description: "Verbose logging",
  }),
  run: cmd.flag({
    type: cmd.boolean,
    long: "run",
    short: "r",
    description: "Run command after building (only for single command)",
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

const appCmd = cmd.command({
  name: basename(__filename),
  description: "Build commands and tools using esbuild bundler",
  args: argSpec,
  handler: async (args) => {
    configureLogging();
    if (args.vscode_ext && args.vscode_mock)
      throw new Error("Must use only one of --vscode-ext or --vscode-mock");
    const noExec = args.noExec || args.vscode_ext;
    if (args.run && noExec) throw new Error("Cannot run file without making it executable");

    const cwd = args.cwd ?? process.cwd();
    assert(args.files.length > 0, "No entry points specified!");
    const files = args.run ? [args.files[0]] : args.files;
    const entryPoints = files.map((path) => {
      if (isDirectorySync(path)) path = join(path, DEFAULT_MAIN_FILE);
      assert(existsSync(path), `Entry point ${path} does not exist`);
      // path of source file relative to base (src) directory
      const srcRelPath = relative(OUT_BASE, path);
      // path of output file
      const outPath = join(cwd, OUT_DIR, srcRelPath);
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

    const runEsbuild = async (entryPoints: string[], entryNames: string) => {
      if (entryPoints.length === 0) return;
      if (args.verbose) {
        console.log(`Building ${entryPoints.toString()}`);
      }

      const external = [
        "esbuild",
        // required but not used by `http-cookie-agent` used by `NodeJS-midway`
        "deasync",
      ];
      if (args.vscode_ext || args.vscode_mock) external.push("vscode");
      const options: esbuild.BuildOptions = {
        absWorkingDir: cwd,
        entryPoints,
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
        metafile: args.analyze,
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
      const result = await esbuild.build(options);

      if (args.analyze) {
        // TODO: try setting verbose to true
        logger.info(
          await esbuild.analyzeMetafile(result.metafile!, { verbose: true, color: true }),
        );
      }
    };

    // esbuild doesn't support different entry name templates in one job so we must split into two jobs
    await runEsbuild(
      entryPoints.filter((e) => e.hasMain).map((e) => e.src),
      "[dir]",
    );
    await runEsbuild(
      entryPoints.filter((e) => !e.hasMain).map((e) => e.src),
      "[dir]/[name]",
    );

    if (!noExec) {
      for (const entrypoint of entryPoints) {
        const out = entrypoint.out;
        renameSync(out + ".js", out);
        chmodSync(out, 0o775);
      }
    }

    if (args.run) {
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
