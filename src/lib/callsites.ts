/**
 * See https://v8.dev/docs/stack-trace-api
 *
 * Taken from https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/node/globals.d.ts
 */
declare global {
  namespace NodeJS {
    interface CallSite {
      /** Is this an async call (i.e. await, Promise.all(), or Promise.any())? */
      isAsync(): boolean;

      /** Is this an async call to Promise.all()? */
      isPromiseAll(): boolean;

      /**
       * Returns the index of the promise element that was followed in Promise.all() or
       * Promise.any() for async stack traces, or null if the CallSite is not an async
       */
      getPromiseIndex(): number | null;

      getScriptNameOrSourceURL(): string;
      getScriptHash(): string;

      getEnclosingColumnNumber(): number;
      getEnclosingLineNumber(): number;
      getPosition(): number;

      toString(): string;
    }
  }
}

export function getCallsites() {
  const _prepareStackTrace = Error.prepareStackTrace;
  try {
    let result: NodeJS.CallSite[] = [];
    Error.prepareStackTrace = (_, callSites) => {
      const callSitesWithoutCurrent = callSites.slice(1);
      result = callSitesWithoutCurrent;
      return callSitesWithoutCurrent;
    };

    new Error().stack;
    return result;
  } finally {
    Error.prepareStackTrace = _prepareStackTrace;
  }
}
