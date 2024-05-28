import * as fs from "node:fs";

export * from "fs-extra";

export function isDirectorySync(path: string) {
  const stat = fs.statSync(path);
  return stat.isDirectory();
}
