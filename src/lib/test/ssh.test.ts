/**
 * @file Test running commands over SSH
 *
 *   To avoid connecting to remote servers, use `localhost` as destination.
 *
 *   Preparation:
 *
 *   - Run `ssh-copy-id localhost` to authorized your keys.
 *   - On Mac enable System Preferences > General > Sharing > Advanced > Remote Login > Allow Remote
 *       Login
 */

import { assert } from "@sergei-dyshel/typescript/error";
import { writeFile } from "fs/promises";
import { Ssh } from "..";
import { configureLogging } from "../logging";
import { testInTempDir, verifyFile } from "../testing";

configureLogging();

const LOCALHOST = "localhost";

void testInTempDir("basic", async () => {
  const ssh = new Ssh.Instance(LOCALHOST, {
    cwd: process.cwd(),
    log: { shouldLog: true, prefix: "[ssh] + " },
    run: { log: { shouldLog: true }, check: true },
  });

  // write file and verify it shows in `ls` output
  await writeFile("test.txt", "test");
  const result = await ssh.run("ls", { run: { stdout: "pipe" } });
  assert(result.stdout == "test.txt\n");

  // read file remotely
  assert((await ssh.readFile("test.txt")) == "test");

  // write file remotely
  await ssh.writeFile("test.txt", "test1", { mode: 0o755 });
  await verifyFile("test.txt", "test1");
});
