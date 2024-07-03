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

import { test } from "@sergei-dyshel/typescript/testing";
import { configureLogging } from "../logging";
import { SshRunner } from "../ssh";

configureLogging();

void test("basic", async () => {
  const runner = new SshRunner("localhost", {
    log: { shouldLog: true },
    run: { log: { shouldLog: true } },
  });
  await runner.run("ls", { run: { check: true } });
});
