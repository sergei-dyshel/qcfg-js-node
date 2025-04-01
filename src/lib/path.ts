import { homedir } from "node:os";
import * as p from "node:path";
import { default as which } from "which";

export { which };

export function split(path: string): string[] {
  return path.split(Path.sep);
}

export class Path {
  path: string;

  constructor(...paths: (string | Path)[]) {
    this.path = p.join(...paths.map((path) => Path.getString(path)));
  }

  static get sep() {
    return p.sep;
  }

  static getString(path: Path | string) {
    return path instanceof Path ? path.path : path;
  }

  splitAll() {
    return this.path.split(Path.sep);
  }
}

/** Like {@link p.join} but allows first segment to be undefined */
export function pathJoin(initialPath?: string, ...paths: string[]) {
  if (initialPath) {
    return p.join(initialPath, ...paths);
  }
  return p.join(...paths);
}

export function splitOnce(path: string): [start: string, rest: string] {
  const parts = split(path);
  return [parts[0], parts.slice(1).join(Path.sep)];
}

export function stripExt(path: string) {
  const parsed = p.parse(path);
  return p.join(parsed.dir, parsed.name);
}

export function basename(path: string, stripExt = false) {
  const parsed = p.parse(path);
  return stripExt ? parsed.name : parsed.base;
}

export function absPath(path: string) {
  return p.resolve(path);
}

export function relPath(from: string, to?: string) {
  to = to ?? process.cwd();
  return p.relative(from, to);
}

/**
 * Replace leading tilde (~) with home directory
 *
 * Taken from {@link https://github.com/sindresorhus/untildify/blob/main/index.js}
 */
export function untildify(path: string) {
  return path.replace(/^~(?=$|\/|\\)/, homedir());
}

/**
 * Replace home directory in path with tilde (~)
 *
 * Taken from {@link https://github.com/sindresorhus/tildify/blob/main/index.js}
 */
export function tildify(path: string) {
  const normPath = p.normalize(path) + p.sep;
  const homeDir = homedir();
  return (
    normPath.startsWith(homeDir) ? normPath.replace(homeDir + p.sep, `~${p.sep}`) : normPath
  ).slice(0, -1);
}
