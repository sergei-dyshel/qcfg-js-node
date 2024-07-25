/**
 * @file Tool for resolving package path in node_modules.
 *
 *   Works with local node_modules as well as with NPM workspaces.
 */

import { assert, assertNotNull } from "@sergei-dyshel/typescript/error";
import { basename, dirname } from "node:path";
import resolvePackagePath from "resolve-package-path";

function main() {
  const name = process.argv[2];
  assertNotNull(name, "Must give package name");
  const packageJson = resolvePackagePath(name, process.cwd());
  assertNotNull(packageJson, `Could not resolve package ${name}`);
  assert(
    basename(packageJson) === "package.json",
    `Expected package.json, got ${basename(packageJson)}`,
  );

  process.stdout.write(dirname(packageJson));
}

main();
