import { esbuildCmd } from "../esbuild-cmd";

const cwd = process.argv[2];
const cmd = process.argv[3];

async function main() {
  await esbuildCmd(cmd, cwd);
}

void main();
