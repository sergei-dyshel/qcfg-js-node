import { gitShortHash } from "@sergei-dyshel/typescript";
import { assert, assertDeepEqual, assertRejects } from "@sergei-dyshel/typescript/error";
import { omit } from "@sergei-dyshel/typescript/object";
import { test } from "@sergei-dyshel/typescript/testing";
import { writeFile } from "node:fs/promises";
import { withTempDirectory } from "../filesystem";
import { Git } from "../git";
import { ModuleLogger, configureLogging } from "../logging";

const DEFAULT_BRANCH = "master";
const USER_NAME = "Test Tester";
const USER_EMAIL = "tester@test.com";
const logger = new ModuleLogger();

configureLogging();

function gitTest(name: string, fn: (_: Git.RunOptions) => Promise<void>) {
  return test(name, async () =>
    withTempDirectory(
      async (path) => {
        const options: Git.RunOptions = { cwd: path, run: { log: { logger } } };
        await Git.init({ initialBranch: DEFAULT_BRANCH, ...options });
        process.chdir(path);
        return fn(options);
      },
      {
        prefix: "git-test",
      },
    ),
  );
}

void gitTest("isGitRoot", async (options) => {
  assert(await Git.isRepoRoot(options));
});

void gitTest("add and check remote", async (options) => {
  const uriStr = "git@github.com:sergei-dyshel/git-test.git";
  await Git.Remote.add("origin", uriStr, options);
  const remotes = await Git.Remote.list(options);
  assert(remotes["origin"].fetch?.toString() === uriStr);
  assert(remotes["origin"].push?.toString() === uriStr);
});

async function commitFile(
  filename: string,
  content: string,
  message: string,
  options: Git.RunOptions,
) {
  await writeFile(filename, content);
  assertDeepEqual(await Git.status(options), [`?? ${filename}`]);
  await Git.add(filename, options);
  assertDeepEqual(await Git.status(options), [`A  ${filename}`]);
  await Git.commit({ message, ...options });
  assertDeepEqual(await Git.status(options), []);
}

void gitTest("add and commit files, verify log", async (options) => {
  await setUser(options);
  await commitFile("test.txt", "test", "test\n\nbody", options);
  assertDeepEqual(await Git.status(options), []);
  const logEntries = await Git.Log.parse([], options);
  const hash = await Git.revParseHead(options);
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

function setUser(options: Git.RunOptions) {
  return Git.Config.setUser(USER_NAME, USER_EMAIL, options);
}

void gitTest("getting and setting config", async (options) => {
  const key = "test.key";
  const boolVal = true;

  // key not defined
  assertDeepEqual(await Git.Config.get(key, options), undefined);
  assertDeepEqual(await Git.Config.getDefault(key, true, options), true);
  await assertRejects(() => Git.Config.get(key, { check: true, ...options }), Git.Config.Error);

  // set key on local
  await Git.Config.set(key, boolVal, options);
  assertDeepEqual(await Git.Config.getBool(key, options), boolVal);
  // global is still not set
  assertDeepEqual(await Git.Config.getBool(key, { global: true, ...options }), undefined);

  // unset key on local
  await Git.Config.unset(key, options);
  assertDeepEqual(await Git.Config.get(key, options), undefined);
});

void gitTest("diff + getBlob", async (options) => {
  await commitFile("test1.txt", "test line", "test1", options);
  const firstCommit = await Git.revParseHead(options);
  const TEST2_TXT = "test2.txt";
  const TEST2_CONTENT = "test line 2";
  await commitFile(TEST2_TXT, TEST2_CONTENT, "test1", options);
  const TEST3_TXT = "test3.txt";
  const TEST3_CONTENT = "test line 3";
  await commitFile(TEST3_TXT, TEST3_CONTENT, "test1", options);
  const lastCommit = await Git.revParseHead(options);
  const diff = await Git.Diff.parse(`${firstCommit}..${lastCommit}`, options);
  // console.log(diff);
  assertDeepEqual(Object.keys(diff), [TEST2_TXT, TEST3_TXT]);
  for (const file of [TEST2_TXT, TEST3_TXT]) {
    assertDeepEqual(omit(diff[file], "dstFile"), {
      srcFile: undefined,
      stat: { binary: false, insertions: 1, deletions: 0 },
      status: Git.Diff.FileStatus.ADD,
    });
    assertDeepEqual(omit(diff[file].dstFile!, "blob"), { path: file, mode: "100644" });
  }
  assertDeepEqual(
    (await Git.getBlob(diff[TEST2_TXT].dstFile!.blob, options)).toString(),
    TEST2_CONTENT,
  );
});

void gitTest("commit exists", async (options) => {
  await commitFile("test1.txt", "test line", "test1", options);
  const commit = await Git.revParseHead(options);
  assert(await Git.commitExists(commit, options));
  assert(await Git.commitExists(gitShortHash(commit), options));
  assert(!(await Git.commitExists("deadbeef", options)));
});
