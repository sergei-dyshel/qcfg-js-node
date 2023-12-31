import { esbuildCmd } from "../esbuild-cmd";

const cmd = process.argv[2];

async function main() {
  await esbuildCmd(cmd);
}

void main();
