import type NPMCliPackageJson from "@npmcli/package-json";
import * as PackageJson from "@npmcli/package-json";
import { assertNotNull } from "@sergei-dyshel/typescript/error";

export { PackageJson };

const DEPENDECIES_NAMES = ["dependencies", "devDependencies", "optionalDependencies"] as const;
export type DependenciesName = (typeof DEPENDECIES_NAMES)[number];

/**
 * Find package in list of dependecies and return tuple of package version and name of dependecies
 * object.
 */
export function packageJsonFindDependency(
  pkgJson: NPMCliPackageJson,
  pkgName: string,
): [string, DependenciesName] | [undefined, undefined] {
  for (const depsName of DEPENDECIES_NAMES) {
    const deps = pkgJson.content[depsName];
    if (deps) {
      const pkgVer = deps[pkgName];
      if (pkgVer) return [pkgVer, depsName] as const;
    }
  }
  return [undefined, undefined] as const;
}

export function packageJsonSetDepencency(
  pkgJson: NPMCliPackageJson,
  pkgName: string,
  version: string,
  depsName: DependenciesName,
) {
  const deps = pkgJson.content[depsName];
  assertNotNull(deps, `No ${depsName} found in package.json`);
  deps[pkgName] = version;
}
