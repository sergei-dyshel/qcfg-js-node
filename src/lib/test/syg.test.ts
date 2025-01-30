import { assert } from "@sergei-dyshel/typescript/error";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { Git } from "../git";
import { getLogHandlers, LogLevel, ModuleLogger } from "../logging";
import { absPath, pathJoin, which } from "../path";
import { Syg } from "../syg";
import { testConfigureLogging, testInDir, verifyFile } from "../testing";

const DEFAULT_BRANCH = "master";
const logger = new ModuleLogger({ name: "test" });
const REMOTE = "remote";
const REMOTE_DIR = "remote";

testConfigureLogging();

function sygTest(name: string, fn: (_: Syg) => Promise<void>) {
  return testInDir(name, async () => {
    const localDir = "local";
    await mkdir(REMOTE_DIR);
    await mkdir(localDir);

    // prepare remote git repo
    const remoteGit = new Git.Instance({ cwd: REMOTE_DIR, run: { log: { logger } } });
    await remoteGit.init({ initialBranch: DEFAULT_BRANCH });
    await writeFile(pathJoin(REMOTE_DIR, "a.txt"), "test");
    await writeFile(pathJoin(REMOTE_DIR, "b.txt"), "b");
    await remoteGit.add([], { all: true });
    await remoteGit.commit({ message: "Some files" });

    // prepare local git repo
    // omitting cwd because clone must run in parent dir
    await Git.clone(REMOTE_DIR, { directory: localDir, run: { log: { logger } } });
    const gitVerbose = getLogHandlers()[0].level === LogLevel.DEBUG;
    const syg = new Syg({ root: localDir, gitVerbose });

    await syg.init();
    await syg.checkSygGitDir();
    await syg.addRemote(REMOTE, "localhost", absPath(REMOTE_DIR), { setDefault: true });
    const gitBinDir = dirname(await which("git"));
    await syg.setRemoteGitBinDir(REMOTE, gitBinDir);
    await syg.setupRemote(REMOTE);

    await writeFile(pathJoin(localDir, "a.txt"), "test1");
    await syg.sync();

    await verifyFile(pathJoin(REMOTE_DIR, "a.txt"), "test1");

    await writeFile(pathJoin(localDir, "a.txt"), "test2");
    await writeFile(pathJoin(REMOTE_DIR, "a.txt"), "test3");
    await syg.sync();
    await verifyFile(pathJoin(REMOTE_DIR, "a.txt"), "test2");

    await writeFile(pathJoin(localDir, "a.txt"), "test3");
    await writeFile(pathJoin(REMOTE_DIR, "b.txt"), "b1");
    await syg.sync();
    await verifyFile(pathJoin(REMOTE_DIR, "a.txt"), "test3");
    await verifyFile(pathJoin(REMOTE_DIR, "b.txt"), "b");

    await syg.renameRemote(REMOTE, "remote_renamed");
    const updated = await syg.sync();
    assert(!updated);

    await fn(syg);
  });
}

void sygTest("init", async (_) => {
  logger.info("end");
  return Promise.resolve();
});
