import { assertDeepEqual } from "@sergei-dyshel/typescript/error";
import { test } from "@sergei-dyshel/typescript/testing";
import { AsyncContext } from "../async-context";
import { run } from "../subprocess";

async function prefixOutErr(callback: () => Promise<void>) {
  return AsyncContext.transformStd(callback, {
    stdout: (s) => `[stdout] ${s}`,
    stderr: (s) => `[stderr] ${s}`,
  });
}

void test("run inherit stdout/stderr", () =>
  prefixOutErr(async () => {
    const result = await run(
      "echo 'this should be printed to stdout' && echo 'this should be printed to stderr' >&2",
      {
        check: true,
        shell: true,
      },
    );
    assertDeepEqual(result.stdout, undefined);
    assertDeepEqual(result.stderr, undefined);
  }));

void test("run pipe stdout", async () => {
  const stdoutMsg = "captured stdout";
  const result = await run(["echo", "-n", stdoutMsg], {
    stdout: "pipe",
    check: true,
  });
  assertDeepEqual(result.stdout, stdoutMsg);
  assertDeepEqual(result.stderr, undefined);
});

void test("run inherit stdout and redirect stderr to stdout", async () => {
  const stdoutMsg = "captured stdout";
  const stderrMsg = "captured stderr";
  await run(`echo ${stdoutMsg} && sleep 1 && echo ${stderrMsg} >&2`, {
    stderr: "stdout",
    shell: true,
    check: true,
  });
});

void test("run pipe stdout and redirect stderr to stdout", async () => {
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
