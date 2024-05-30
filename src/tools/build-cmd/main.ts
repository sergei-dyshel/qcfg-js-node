import { assert } from "@sergei-dyshel/typescript/error";
import * as cmd from "cmd-ts";
import * as esbuild from "esbuild";
import { chmodSync, existsSync, renameSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { isDirectorySync } from "../../lib/filesystem";
import { stripExt } from "../../lib/path";
import { run } from "../../lib/subprocess";

const OUT_BASE = "src";
const OUT_DIR = "dist";
const DEFAULT_MAIN_FILE = "main.ts";

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
} as const;

const appCmd = cmd.command({
  name: basename(__filename),
  description: "Build commands and tools using esbuild bundler",
  args: argSpec,
  handler: async (args) => {
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

    const runEsbuild = async (entryPoints: string[], entryNames: string) => {
      if (entryPoints.length === 0) return;
      if (args.verbose) {
        console.log(`Building ${entryPoints.toString()}`);
      }

      const options: esbuild.BuildOptions = {
        absWorkingDir: cwd,
        entryPoints,
        outdir: OUT_DIR,
        outbase: OUT_BASE,
        entryNames,
        banner: {
          // see https://sambal.org/2014/02/passing-options-node-shebang-line/
          js: '#!/bin/bash\n":" //# comment; exec /usr/bin/env node --enable-source-maps ${INSPECT:+--inspect} ${INSPECT_BRK:+--inspect-brk} "$0" "$@"',
        },
        bundle: true,
        format: "cjs",
        platform: "node",
        target: "es2022",
        sourcemap: "inline",
        external: ["esbuild"],
        // preserve function and classes names so not to break reflection
        keepNames: true,
        metafile: args.analyze,
        minify: args.analyze,
        lineLimit: 100,
        color: true,
        logLevel: args.verbose ? "info" : "warning",
      };
      const result = await esbuild.build(options);

      if (args.analyze) {
        // TODO: try setting verbose to true
        console.log(
          await esbuild.analyzeMetafile(result.metafile!, { verbose: false, color: true }),
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

    for (const entrypoint of entryPoints) {
      const out = entrypoint.out;
      renameSync(out + ".js", out);
      chmodSync(out, 0o775);
    }

    if (args.run) {
      const cmd = ["node", "--enable-source-maps"];
      if (args.debug) cmd.push("--inspect-brk");
      const result = await run([...cmd, entryPoints[0].out, "--", ...args.files.slice(1)]);
      process.exit(result.exitCode!);
    }
  },
});

void cmd.run(appCmd, process.argv.slice(2));
