import { assert, assertDeepEqual, assertRejects } from "@sergei-dyshel/typescript/error";
import { omit } from "@sergei-dyshel/typescript/object";
import { test } from "@sergei-dyshel/typescript/testing";
import { writeFile } from "node:fs/promises";
import { withTempDirectory } from "../filesystem";
import { Git, GitConfigError, GitDiffFileStatus, gitShortHash } from "../git";
import { ModuleLogger, configureLogging } from "../logging";

const DEFAULT_BRANCH = "master";
const USER_NAME = "Test Tester";
const USER_EMAIL = "tester@test.com";
const logger = new ModuleLogger();

configureLogging();
function gitTest(name: string, fn: (_: Git) => Promise<void>) {
  return test(name, async () =>
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

void gitTest("isGitRoot", async (git) => {
  assert(await git.isRepoRoot());
});

void gitTest("add and check remote", async (git) => {
  const uriStr = "git@github.com:sergei-dyshel/git-test.git";
  await git.remoteAdd("origin", uriStr);
  const remotes = await git.remoteList();
  assert(remotes["origin"].fetch?.toString() === uriStr);
  assert(remotes["origin"].push?.toString() === uriStr);
});

async function commitFile(git: Git, filename: string, content: string, message: string) {
  await writeFile(filename, content);
  assertDeepEqual(await git.status(), [`?? ${filename}`]);
  await git.add(filename);
  assertDeepEqual(await git.status(), [`A  ${filename}`]);
  await git.commit({ message });
  assertDeepEqual(await git.status(), []);
}

void gitTest("add and commit files, verify log", async (git) => {
  await setUser(git);
  await commitFile(git, "test.txt", "test", "test\n\nbody");
  assertDeepEqual(await git.status(), []);
  const logEntries = await git.parseLog([]);
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

void gitTest("getting and setting config", async (git) => {
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

void gitTest("diff + getBlob", async (git) => {
  await commitFile(git, "test1.txt", "test line", "test1");
  const firstCommit = await git.revParseHead();
  const TEST2_TXT = "test2.txt";
  const TEST2_CONTENT = "test line 2";
  await commitFile(git, TEST2_TXT, TEST2_CONTENT, "test1");
  const TEST3_TXT = "test3.txt";
  const TEST3_CONTENT = "test line 3";
  await commitFile(git, TEST3_TXT, TEST3_CONTENT, "test1");
  const lastCommit = await git.revParseHead();
  const diff = await git.parseDiff(`${firstCommit}..${lastCommit}`);
  // console.log(diff);
  assertDeepEqual(Object.keys(diff), [TEST2_TXT, TEST3_TXT]);
  for (const file of [TEST2_TXT, TEST3_TXT]) {
    assertDeepEqual(omit(diff[file], "dstFile"), {
      srcFile: undefined,
      stat: { binary: false, insertions: 1, deletions: 0 },
      status: GitDiffFileStatus.ADD,
    });
    assertDeepEqual(omit(diff[file].dstFile!, "blob"), { path: file, mode: "100644" });
  }
  assertDeepEqual((await git.getBlob(diff[TEST2_TXT].dstFile!.blob)).toString(), TEST2_CONTENT);
});

void gitTest("commit exists", async (git) => {
  await commitFile(git, "test1.txt", "test line", "test1");
  const commit = await git.revParseHead();
  assert(await git.commitExists(commit));
  assert(await git.commitExists(gitShortHash(commit)));
  assert(!(await git.commitExists("deadbeef")));
});
