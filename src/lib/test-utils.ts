import { PassThrough } from "stream";

export async function withCaptureStdout(fn: () => unknown): Promise<string> {
  const stdoutPassthrough = new PassThrough();
  stdoutPassthrough.setEncoding("utf8");

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const origStdoutWrite = process.stdout.write;

  process.stdout.write = function write() {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    // eslint-disable-next-line prefer-rest-params
    origStdoutWrite(...arguments);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    // eslint-disable-next-line prefer-rest-params
    stdoutPassthrough.write(...arguments);
  } as unknown as typeof origStdoutWrite;
  try {
    await fn();
    return stdoutPassthrough.read() as string;
  } finally {
    process.stdout.write = origStdoutWrite;
  }
}
