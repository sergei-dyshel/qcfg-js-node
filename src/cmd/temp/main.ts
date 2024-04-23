import { Stdio, run } from "../../subprocess";

async function main() {
  const result = await run(["ls", "bla"], { stdout: Stdio.PIPE, check: true });
  console.log(result);
}

void main();
