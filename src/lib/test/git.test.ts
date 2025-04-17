import { gitShortHash } from "@sergei-dyshel/typescript";
import { addToDate } from "@sergei-dyshel/typescript/datetime";
import { assert, assertDeepEqual, assertRejects } from "@sergei-dyshel/typescript/error";
import { omit } from "@sergei-dyshel/typescript/object";
import { test } from "@sergei-dyshel/typescript/testing";
import type { Awaitable } from "@sergei-dyshel/typescript/types";
import { writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { Git } from "../git";
import { ModuleLogger } from "../logging";
import { pathJoin } from "../path";
import { testConfigureLogging, testInDir } from "../testing";

const DEFAULT_BRANCH = "master";
const USER_NAME = "Test Tester";
const USER_EMAIL = "tester@test.com";
const logger = new ModuleLogger();

testConfigureLogging();

function gitTest(fn: (_: Git.RunOptions) => Awaitable<void>) {
  return testInDir(async () => {
    const options: Git.RunOptions = { run: { log: { logger, shouldLog: true } } };
    await Git.init({ initialBranch: DEFAULT_BRANCH, ...options });
    return fn(options);
  });
}

void test(
  "isGitRoot",
  gitTest(async (options) => {
    assert(await Git.isRepoRoot(options));
  }),
);

void test(
  "add and check remote",
  gitTest(async (options) => {
    const uriStr = "git@github.com:sergei-dyshel/git-test.git";
    await Git.Remote.add("origin", uriStr, options);
    const remotes = await Git.Remote.list(options);
    assertDeepEqual(remotes["origin"].fetch?.toString(), uriStr);
    assertDeepEqual(remotes["origin"].push?.toString(), uriStr);
    assertDeepEqual(await Git.Config.Remote.get("origin", "url", options), uriStr);
  }),
);

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

async function gitCommitFile(
  git: Git.Instance,
  filename: string,
  content: string,
  message: string,
) {
  await writeFile(filename, content);
  assertDeepEqual(await git.status(), [`?? ${filename}`]);
  await git.add(filename);
  assertDeepEqual(await git.status(), [`A  ${filename}`]);
  await git.commit({ message });
  assertDeepEqual(await git.status(), []);
}

void test(
  "add and commit files, verify log",
  gitTest(async (options) => {
    await setUser(options);
    await commitFile("test.txt", "test", "test\n\nbody", options);
    assertDeepEqual(await Git.status(options), []);
    const logEntries = await Git.Log.parse([], options);
    const hash = await Git.RevParse.head(options);
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
  }),
);

function setUser(options: Git.RunOptions) {
  return Git.Config.setUser(USER_NAME, USER_EMAIL, options);
}

void test(
  "getting and setting config (unknown key)",
  gitTest(async (options) => {
    const key = "test.key";
    const boolVal = true;

    // key not defined
    assertDeepEqual(await Git.Config.getCustom(key, options), undefined);
    await assertRejects(
      () => Git.Config.getCustom(key, { check: true, ...options }),
      Git.Config.Error,
    );

    // set key on local
    await Git.Config.setCustom(key, boolVal, options);
    assertDeepEqual(await Git.Config.getCustom(key, { ...options, type: "bool" }), boolVal);
    // global is still not set
    assertDeepEqual(
      await Git.Config.getCustom(key, { global: true, type: "bool", ...options }),
      undefined,
    );

    // unset key on local
    await Git.Config.unsetCustom(key, options);
    assertDeepEqual(await Git.Config.getCustom(key, options), undefined);
  }),
);

void test(
  "getting and setting config (known key)",
  gitTest(async (options) => {
    await setUser(options);

    assertDeepEqual<string | undefined>(await Git.Config.get("user.name", options), USER_NAME);
    assertDeepEqual<number | undefined>(await Git.Config.get("core.abbrev", options), 8);

    await Git.Config.set("rebase.autoStash", true, options);
    assertDeepEqual<boolean | undefined>(await Git.Config.get("rebase.autoStash", options), true);

    // setting boolean config to non-boolean value shouuld work but triggers type error
    // @ts-expect-error
    await Git.Config.set("rebase.autoStash", "invalid", options);
  }),
);

void test(
  "diff + getBlob",
  gitTest(async (options) => {
    await commitFile("test1.txt", "test line", "test1", options);
    const firstCommit = await Git.RevParse.head(options);
    const TEST2_TXT = "test2.txt";
    const TEST2_CONTENT = "test line 2";
    await commitFile(TEST2_TXT, TEST2_CONTENT, "test1", options);
    const TEST3_TXT = "test3.txt";
    const TEST3_CONTENT = "test line 3";
    await commitFile(TEST3_TXT, TEST3_CONTENT, "test1", options);
    const lastCommit = await Git.RevParse.head(options);
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
  }),
);

void test(
  "commit exists",
  gitTest(async (options) => {
    await commitFile("test1.txt", "test line", "test1", options);
    const commit = await Git.RevParse.head(options);
    assert(await Git.commitExists(commit, options));
    assert(await Git.commitExists(gitShortHash(commit), options));
    assert(!(await Git.commitExists("deadbeef", options)));
  }),
);

void test(
  "rev-parse directories",
  gitTest(async (options) => {
    const toplevel = await Git.RevParse.showToplevel(options);
    assertDeepEqual(toplevel, process.cwd());

    const gitDir = pathJoin(process.cwd(), Git.DEFAULT_GIT_DIR);
    assertDeepEqual(await Git.RevParse.resolveGitDir(gitDir, options), gitDir);
  }),
);

void test(
  "git log filtering",
  gitTest(async (options) => {
    const git = new Git.Instance(options);
    await gitCommitFile(git, "test1.txt", "test line", "commit1\n\nfoo bar");
    // make commits have different seconds in commit date
    await setTimeout(1500);
    await gitCommitFile(git, "test2.txt", "test line", "commit2\n\nfoo qux");

    const log1 = await git.logParse(undefined, { grep: "bar" });
    assertDeepEqual(log1.length, 1);
    const fooBarEntry = log1[0];
    assertDeepEqual(fooBarEntry.subject, "commit1");

    // filter by commit date greater than that of the first commit, only second commit should match
    const log2 = await git.logParse(undefined, {
      after: addToDate(fooBarEntry.committerDate, { seconds: 1 }),
      grep: "foo",
      fixedStrings: true,
    });
    assertDeepEqual(log2.length, 1);
    assertDeepEqual(log2[0].subject, "commit2");
  }),
);
