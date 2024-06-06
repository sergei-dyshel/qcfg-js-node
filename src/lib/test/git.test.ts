/* eslint-disable @typescript-eslint/no-floating-promises */
import { assert } from "@sergei-dyshel/typescript/error";
import { test } from "@sergei-dyshel/typescript/testing";
import { withTempDirectory } from "../filesystem";
import { Git } from "../git";
import { ModuleLogger, configureLogging } from "../logging";

const DEFAULT_BRANCH = "master";

const logger = new ModuleLogger();

configureLogging();

async function gitTest(name: string, fn: (_: Git) => Promise<void>) {
  return test(name, async () =>
    withTempDirectory(
      async (path) => {
        const git = new Git({ cwd: path, runnerOptions: { log: { logger } } });
        await git.init({ initialBranch: DEFAULT_BRANCH });
        return fn(git);
      },
      {
        prefix: "git-test",
      },
    ),
  );
}

gitTest("isGitRoot", async (git) => {
  assert(await git.isRepoRoot());
});

gitTest("add and check remote", async (git) => {
  const uriStr = "git@github.com:sergei-dyshel/git-test.git";
  await git.remoteAdd("origin", uriStr);
  const remotes = await git.remoteList();
  assert(remotes["origin"].fetch?.toString() === uriStr);
  assert(remotes["origin"].push?.toString() === uriStr);
});
