import { LoggableError } from "@sergei-dyshel/typescript/error";
import { UriLike } from "@sergei-dyshel/typescript/uri";
import { basename } from "path";
import { Path } from "./path";

export class GithubRepoParseError extends LoggableError {
  constructor(msg: string, uri: UriLike) {
    super(`${msg}: ${uri.toString()}`);
  }
}

export class GithubRepo {
  constructor(
    public user: string,
    public name: string,
  ) {}

  static parseUri(uri: UriLike): GithubRepo {
    if (uri.authority !== "github.com") throw new GithubRepoParseError(`Not a github repo`, uri);
    const pathComponents = new Path(uri.path).splitAll();
    if (pathComponents.length < 2)
      throw new GithubRepoParseError("Not enough path components ", uri);
    const [_, user, name, ..._rest] = pathComponents;
    return new GithubRepo(user, basename(name, ".git"));
  }

  toString() {
    return `${this.user}/${this.name}`;
  }

  asDependencyVersion(commit?: string) {
    let version = this.toString();
    if (commit) version += `#${commit}`;
    return version;
  }
}
