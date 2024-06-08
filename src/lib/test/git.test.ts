import { assert, assertDeepEqual, assertRejects } from "@sergei-dyshel/typescript/error";
import { omit } from "@sergei-dyshel/typescript/object";
import { test } from "@sergei-dyshel/typescript/testing";
import { writeFile } from "node:fs/promises";
import { withTempDirectory } from "../filesystem";
import { Git, GitConfigError } from "../git";
import { ModuleLogger, configureLogging } from "../logging";

const DEFAULT_BRANCH = "master";
const USER_NAME = "Test Tester";
const USER_EMAIL = "tester@test.com";
const logger = new ModuleLogger();

configureLogging();

function gitTest(name: string, fn: (_: Git) => Promise<void>) {
  test(name, async () =>
    withTempDirectory(
      async (path) => {
        const git = new Git({ cwd: path, runnerOptions: { log: { logger } } });
        await git.init({ initialBranch: DEFAULT_BRANCH });
        process.chdir(path);
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

gitTest("add and commit files, verify log", async (git) => {
  await setUser(git);
  const file = "test.txt";
  await writeFile(file, "test");
  await git.add(file);
  await git.commit({ message: "test\n\nbody" });
  const logEntries = await git.parseLog();
  const hash = await git.revParseHead();
  assertDeepEqual(
    logEntries.map((l) => omit(l, "authorDate", "committerDate")),
    [
      {
        hash,
        subject: "test",
        body: "body\n",
        authorName: USER_NAME,
        authorEmail: USER_EMAIL,
        committerName: USER_NAME,
        committerEmail: USER_EMAIL,
      },
    ],
  );
});

function setUser(git: Git) {
  return git.setUser(USER_NAME, USER_EMAIL);
}

gitTest("getting and setting config", async (git) => {
  const key = "test.key";
  const boolVal = true;

  // key not defined
  assertDeepEqual(await git.configGet(key), undefined);
  assertDeepEqual(await git.configGetDefault(key, true), true);
  await assertRejects(() => git.configGet(key, { check: true }), GitConfigError);

  // set key on local
  await git.configSet(key, boolVal);
  assertDeepEqual(await git.configGetBool(key), boolVal);
  // global is still not set
  assertDeepEqual(await git.configGetBool(key, { global: true }), undefined);

  // unset key on local
  await git.configUnset(key);
  assertDeepEqual(await git.configGet(key), undefined);
});
