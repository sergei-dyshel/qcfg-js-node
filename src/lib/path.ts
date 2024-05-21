import * as p from "node:path";

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
