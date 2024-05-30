import * as p from "node:path";

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
