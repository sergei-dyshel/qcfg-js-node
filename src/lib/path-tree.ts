import { assert } from "@sergei-dyshel/typescript/error";
import { Path, split } from "./path";

interface Tree<T> {
  /** Name (last segment of path) of this tree node */
  name: string;

  /** Full path to this tree node */
  path: string;

  // exactly one of these will be present
  obj?: T;
  children?: Tree<T>[];
}

function buildTrees<T>(files: [path: string, obj: T][]): Tree<T>[] {
  const trees: Tree<T>[] = [];
  for (const [path, obj] of files) {
    assert(
      !path.startsWith(Path.sep) && !path.endsWith(Path.sep),
      "Path must not start or end with separator",
    );
    addPath(trees, split(path), obj);
  }
  coalesceFolders(trees);
  return trees;
}

/** When folder has only one subfolder, join their names */
function coalesceFolders<T>(trees: Tree<T>[]) {
  for (const tree of trees) {
    if (!tree.children) continue;
    coalesceFolders(tree.children);
    if (tree.children.length === 1) {
      const child = tree.children[0];
      if (child.children) {
        tree.name = [tree.name, child.name].join(Path.sep);
        tree.path = [tree.path, child.name].join(Path.sep);
        tree.obj = child.obj;
        tree.children = child.children;
      }
    }
  }
}

function addPath<T>(trees: Tree<T>[], segments: string[], obj: T, parentPath?: string) {
  assert(segments.length > 0, `Empty path`);
  const [name, ...rest] = segments;
  const path = parentPath ? [parentPath, name].join(Path.sep) : name;
  let tree = trees.find((t) => t.name === name);
  if (tree) {
    assert(rest.length !== 0, `Duplicate path ${path}`);
  } else {
    tree = { name, path };
    trees.push(tree);
    if (rest.length === 0) {
      tree.obj = obj;
      return;
    }
    tree.children = [];
  }
  addPath(tree.children!, rest, obj, path);
}

export function buildFileTree<Folder, File, Parent, T>(
  files: T[],
  parent: Parent,
  getPath: (_: T) => string,
  // REFACTOR: parent is never used => remove
  makeFolder: (
    name: string,
    path: string,
    parent: Folder | Parent,
    children: (Folder | File)[],
  ) => Folder,
  makeFile: (name: string, obj: T, parent: Folder | Parent) => File,
): (Folder | File)[] {
  const impl = (trees: Tree<T>[], parent: Folder | Parent): (Folder | File)[] =>
    trees.map((tree) => {
      if (tree.children) {
        return makeFolder(tree.name, tree.path, parent, impl(tree.children, parent));
      }
      return makeFile(tree.name, tree.obj!, parent);
    });
  const trees = buildTrees(files.map((file) => [getPath(file), file]));
  return impl(trees, parent);
}
