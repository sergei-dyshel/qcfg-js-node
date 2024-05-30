// REFACTOR: remove this

import { assert, assertNotNull } from "@sergei-dyshel/typescript/error";
import { P, match } from "@sergei-dyshel/typescript/pattern";
import { removePrefix } from "@sergei-dyshel/typescript/string";
import { URI } from "@sergei-dyshel/typescript/uri";
import * as cmd from "cmd-ts";
import { readFileSync } from "fs";
import { basename } from "path";
import { Git } from "../../lib/git";
import { GithubRepo } from "../../lib/github";
import { LogLevel, MainLogger } from "../../lib/logging";
import { configureLogging } from "../../lib/logging/logger";
import {
  PackageJson,
  packageJsonFindDependency,
  packageJsonSetDepencency,
} from "../../lib/package-json";

const logger = new MainLogger({ name: __filename });

const argSpec = {
  verbose: cmd.flag({
    long: "verbose",
    short: "v",
  }),
  dryRun: cmd.flag({
    long: "dry-run",
    short: "n",
  }),
};

const appCmd = cmd.command({
  name: basename(__filename),
  description: "Update linked hashes in package.json",
  args: argSpec,
  handler: async (args) => {
    configureLogging({ handler: { level: args.verbose ? LogLevel.DEBUG : LogLevel.INFO } });
    const thisPkgJson = await PackageJson.load(".");
    const linkJson = JSON.parse(readFileSync("link.config.json", "utf8")) as {
      packages: string[];
    };
    for (const pkg of linkJson.packages) {
      logger.info(`Processing ${pkg}`);
      const pkgJson = await PackageJson.load(pkg);
      const pkgName = pkgJson.content.name!;
      logger.debug(`Package name ${pkgName}`);
      const [currentVer, depsName] = packageJsonFindDependency(thisPkgJson, pkgName);
      assertNotNull(currentVer, `Package is not listed as dependency`);
      if (currentVer === "*") {
        logger.info("This is Brazil package, skipping");
        continue;
      }
      logger.debug(`Current version ${currentVer} (listed in ${depsName})`);
      const repo = match(pkgJson.content.repository)
        .with(undefined, () => {
          throw new Error(`No repository found for ${pkgJson.content.name}`);
        })
        .with(P.string, (str) => str)
        .otherwise(({ url }) => url);
      const uri = URI.parse(repo);
      logger.debug(`Repository ${uri.toString()}`);
      const gpRepo = GithubRepo.parseUri(uri);
      const depRepo = gpRepo.asDependencyVersion();
      assert(
        currentVer.startsWith(depRepo),
        "Dependency version and Github repo from package.json do not match",
      );

      const git = new Git({ cwd: pkg });
      const status = await git.status();
      assert(status.length == 0, "There are uncommitted changes");
      const newCommit = await git.revParseHead();
      assert(await git.commitExistsOnRemote(newCommit), "Commit is not on remote");

      const currentCommit = removePrefix(currentVer, depRepo + "#");
      if (currentCommit != newCommit) {
        logger.info(`Updating ${pkgName} from ${currentCommit} to ${newCommit}`);
        packageJsonSetDepencency(
          thisPkgJson,
          pkgName,
          gpRepo.asDependencyVersion(newCommit),
          depsName,
        );
      }
    }
    if (!args.dryRun) {
      await thisPkgJson.save();
    }
  },
});

void cmd.run(appCmd, process.argv.slice(2));
