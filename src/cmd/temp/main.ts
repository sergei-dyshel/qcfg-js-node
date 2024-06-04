import { exec } from "../../lib/native-exec";
import { RunError, run } from "../../lib/subprocess";

function logException(_: string, err: unknown) {
  if (err instanceof Error) {
    const cause = err.cause;
    const obj = err instanceof RunError ? { stderr: err.result.stderr } : undefined;
    console.log(`${err.name}: ${err.message}\n${err.stack}`, obj);
    // logger.error(msg, err, obj);
    logException("Caused by:", cause);
    logException("", cause);
  }
}

async function main() {
  exec(["ssh", "yoko-s0"]);
  return;
  const arg1 = [
    "this is some array",
    "const obj = err instanceof CheckError ? { stderr: err.result.stderr } : undefined;",
    "console.log(`${err.name}: ${err.message}\n${err.stack}`, obj);",
  ];

  const arg2 = {
    field1: "this is some array",
    field2: "const obj = err instanceof CheckError ? { stderr: err.result.stderr } : undefined;",
    field3: "console.log(`${err.name}: ${err.message}\n${err.stack}`, obj);",
  };

  console.error("some message\n\n\n", arg2, arg1);
  console.warn("another message\n\n\n", { arg2, arg1 });
  return;
  try {
    try {
      await run(["ls", "bla"], {
        stdout: "pipe",
        stderr: "pipe",
        check: true,
      });
    } catch (err) {
      throw new Error("run failed with error", { cause: err });
    }
  } catch (err) {
    logException("Failed with error", err);
  }
}

void main();
