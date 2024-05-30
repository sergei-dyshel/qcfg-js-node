import { mapSourcePosition, type Position } from "source-map-support";

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

      /**
       * Returns callsite representation in form of "<function name> (<filename>:<line>:<column>)",
       * similar to one used in error stack traces.
       */
      toString(): string;
    }
  }
}

/**
 * Returns array of {@link NodeJS.Callsite} objects for the current stack trace.
 *
 * Implementation borrowed from https://github.com/sindresorhus/callsites/blob/main/index.js. In
 * bundled code locations need to be transformed according to source map with
 * {@link sourceMapCallsite}.
 */
function getCallsites() {
  const _prepareStackTrace = Error.prepareStackTrace;
  try {
    let result: NodeJS.CallSite[] = [];
    Error.prepareStackTrace = (_, callSites) => {
      // top callsite will be for inside this function
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

/** Wrapper helper for {@link NodeJS.CallSite}. */
export class CallSite {
  private _position?: Position;

  static ANONYMOUS = "<anonymous>";

  constructor(public readonly callsite: NodeJS.CallSite) {}

  get position() {
    // REFACTOR: use memoize decorator
    if (!this._position)
      this._position = mapSourcePosition({
        source: this.callsite.getFileName()!,
        line: this.callsite.getLineNumber()!,
        column: this.callsite.getColumnNumber()!,
      });
    return this._position;
  }

  get file() {
    return this.position.source;
  }

  get line() {
    return this.position.line;
  }

  get column() {
    return this.position.column;
  }

  get function() {
    const str = this.callsite.toString();
    if (str.includes("(")) return str.substring(0, str.indexOf("(") - 1);
    return CallSite.ANONYMOUS;
  }

  toString() {
    return this.callsite.toString();
  }
}

/**
 * Callsite for the caller of this function.
 *
 * @param framesToSkip Number of top stack frames to skip
 */
export function getCallsite(framesToSkip = 0) {
  return new CallSite(getCallsites()[framesToSkip + 1]);
}
