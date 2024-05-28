import { assert } from "@sergei-dyshel/typescript/error";
import * as cmd from "cmd-ts";
import * as esbuild from "esbuild";
import { chmodSync, renameSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { isDirectorySync } from "../../lib/filesystem";

const OUT_BASE = "src";
const OUT_DIR = "dist";
const DEFAULT_MAIN_FILE = "main.ts";

const argSpec = {
  entrypoints: cmd.restPositionals({
    type: cmd.string,
    displayName: "entry point",
    description: `Path to command main TS file or its directory (then ${DEFAULT_MAIN_FILE} filename is assumed)`,
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
} as const;

const appCmd = cmd.command({
  name: basename(__filename),
  description: "Build commands and tools using esbuild bundler",
  args: argSpec,
  handler: async (args) => {
    const cwd = args.cwd ?? process.cwd();
    const entryPoints = (args.entrypoints ?? []).map((p) =>
      isDirectorySync(p) ? join(p, DEFAULT_MAIN_FILE) : p,
    );
    assert(entryPoints.length > 0, "No entry points specified!");
    if (args.verbose) {
      console.log(`Building ${entryPoints.toString()}`);
    }
    const options: esbuild.BuildOptions = {
      absWorkingDir: cwd,
      entryPoints,
      outdir: OUT_DIR,
      outbase: OUT_BASE,
      entryNames: "[dir]",
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
    for (const entrypoint of entryPoints) {
      const outRel = relative(OUT_BASE, entrypoint);
      const noExt = join(cwd, OUT_DIR, dirname(outRel));
      const withExt = noExt + ".js";
      renameSync(withExt, noExt);
      chmodSync(noExt, 0o775);
    }

    if (args.analyze) {
      // try setting verbose to true
      console.log(await esbuild.analyzeMetafile(result.metafile!, { verbose: false, color: true }));
    }
  },
});

void cmd.run(appCmd, process.argv.slice(2));
