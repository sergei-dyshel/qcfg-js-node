import { deepMerge } from "@sergei-dyshel/typescript/deep-merge";
import { assert } from "@sergei-dyshel/typescript/error";
import { test } from "@sergei-dyshel/typescript/testing";
import { mkdir, readFile } from "fs/promises";
import { emptyDir, exists } from "./filesystem";
import {
  configureLogging,
  type LoggingOptions,
  LogLevel,
  LogLevels,
  ModuleLogger,
} from "./logging";
import { withChdir } from "./process";
import { TempDirectory } from "./tempDirectory";

/** Should be used by all tests */
export const logger = new ModuleLogger({ name: "test" });

const TEST_DIR = ".test";

export async function verifyFileDoesNotExist(path: string) {
  assert(!(await exists(path)), `File ${path} exists while it should not`);
}

export async function verifyFileExists(path: string) {
  assert(await exists(path), `File ${path} does not exists while it should`);
}

export async function verifyFile(path: string, text: string) {
  const currentText = await readFile(path, "utf8");
  assert(
    currentText === text,
    `File ${path} has wrong content: expected "${text}", got "${currentText}"`,
  );
}

/**
 * Run test in new temporary directory.
 *
 * Also chdir to that directory during the test.
 */
export function testInTempDir(name: string, fn: () => Promise<void>) {
  return test(name, async () => {
    await using tempDir = await TempDirectory.create();
    logger.info(`Running test in temporary directory ${tempDir.name}`);
    await withChdir(tempDir.name, fn);
  });
}

/**
 * Runs test in fixed directory ({@link TEST_DIR}) that is cleaned before the test.
 *
 * Convenient for debugging, e.g. allow having terminals open in test dir.
 */
export function testInTestDir(name: string, fn: () => Promise<void>) {
  return test(name, async () => {
    logger.info(`Running test in ${TEST_DIR}`);
    await mkdir(TEST_DIR, { recursive: true });
    await emptyDir(TEST_DIR);
    return withChdir(TEST_DIR, fn);
  });
}

export function testConfigureLogging(options?: LoggingOptions) {
  const envLevel = process.env["QCFG_TEST_LOG_LEVEL"];
  const logLevel = envLevel ? LogLevels.fromString(envLevel) : LogLevel.INFO;
  configureLogging(deepMerge({ handler: { level: logLevel } }, options));
}

export function testInDir(name: string, fn: () => Promise<void>) {
  const useTestDir = process.env["QCFG_TEST_USE_TEST_DIR"] === "1";
  const testFunc = useTestDir ? testInTestDir : testInTempDir;
  return testFunc(name, fn);
}
