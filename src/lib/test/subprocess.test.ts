 
import { assertDeepEqual } from "@sergei-dyshel/typescript/error";
import { test } from "@sergei-dyshel/typescript/testing";
import { run } from "../subprocess";

test("run inherit stdout/stderr", async () => {
  const result = await run(
    "echo 'this should be printed to stdout' && echo 'this should be printed to stderr'",
    {
      check: true,
      shell: true,
    },
  );
  assertDeepEqual(result.stdout, undefined);
  assertDeepEqual(result.stderr, undefined);
});

test("run pipe stdout", async () => {
  const stdoutMsg = "captured stdout";
  const result = await run(["echo", "-n", stdoutMsg], {
    stdout: "pipe",
    check: true,
  });
  assertDeepEqual(result.stdout, stdoutMsg);
  assertDeepEqual(result.stderr, undefined);
});

test("run inherit stdout and redirect stderr to stdout", async () => {
  const stdoutMsg = "captured stdout";
  const stderrMsg = "captured stderr";
  await run(`echo ${stdoutMsg} && sleep 1 && echo ${stderrMsg} >&2`, {
    stderr: "stdout",
    shell: true,
    check: true,
  });
});

test("run pipe stdout and redirect stderr to stdout", async () => {
  const stdoutMsg = "captured stdout";
  const stderrMsg = "captured stderr";
  const result = await run(`echo ${stdoutMsg} && sleep 1 && echo ${stderrMsg} >&2`, {
    stdout: "pipe",
    stderr: "stdout",
    shell: true,
    check: true,
  });
  assertDeepEqual(result.stdout, `${stdoutMsg}\n${stderrMsg}\n`);
  assertDeepEqual(result.stderr, undefined);
});
