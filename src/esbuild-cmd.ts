import * as esbuild from "esbuild";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function esbuildCmd(cmd: string) {
  const options: esbuild.BuildOptions = {
    entryPoints: [`src/cmd/${cmd}/main.ts`],
    outdir: "dist",
    outbase: "src/cmd",
    entryNames: "[dir]",
    color: true,
    logLevel: "info",
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "es2022",
    sourcemap: true,
    keepNames: true,
  };

  await esbuild.build(options);
  const binPath = path.join("bin", cmd);
  await fs.writeFile(
    binPath,
    `#!/usr/bin/env bash

exec node \${INSPECT:+--inspect} \${INSPECT_BRK:+--inspect-brk} $(dirname $0)/../dist/${cmd}.js -- "$@"
`,
  );
  await fs.chmod(binPath, 0o775);
}
