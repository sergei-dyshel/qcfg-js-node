import globalPrefix from "global-prefix";

function isModuleNotFound(err: unknown) {
  return typeof err === "object" && (err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND";
}

function canResolve(name: string) {
  try {
    require.resolve(name);
    return true;
  } catch (err) {
    if (isModuleNotFound(err)) {
      return false;
    }
    throw err;
  }
}

/** If module can be required from local or global location */
export function canResolveLocalOrGlobal(name: string) {
  if (canResolve(name)) return true;
  module.paths.push(globalPrefix + "/lib/node_modules");
  return canResolve(name);
}
