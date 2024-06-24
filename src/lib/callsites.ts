import { assert } from "@sergei-dyshel/typescript/error";
import { join } from "node:path";
import { mapSourcePosition, type Position } from "source-map-support";
import { split } from "./path";

/**
 * See https://v8.dev/docs/stack-trace-api
 *
 * Taken from https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/node/globals.d.ts
 */
declare global {
  export namespace NodeJS {
    export interface CallSite {
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
 * Returns array of CallSite objects for the current stack trace.
 *
 * Implementation borrowed from https://github.com/sindresorhus/callsites/blob/main/index.js.
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

/** Wrapper helper for CallSite. */
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
export function getCallsite(framesToSkip = 0): CallSite {
  return new CallSite(getCallsites()[framesToSkip + 1]);
}

export interface ParsedErrorStackFrame {
  function?: string;
  file: string;
  line: number;
  column: number;
}

/**
 * Formats back to string error stack frame parsed with {@link parseErrorStack}, with some
 * readability enhancements
 */
export function formatErrorStackFrame(frame: ParsedErrorStackFrame): string {
  return `    at ${frame.function ?? "<unnamed>"} (${shortenSourcePath(frame.file)}:${frame.line}:${frame.column})`;
}

function parseStackFrame(line: string): ParsedErrorStackFrame {
  let match = line.match(/^\s+at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)$/);
  if (match)
    return {
      function: match[1],
      file: match[2],
      line: parseInt(match[3]),
      column: parseInt(match[4]),
    };

  match = line.match(/^\s+at\s(.*?):(\d+):(\d+)$/);
  if (!match) {
    throw new Error(`Could not parse stack frame line: ${line}`);
  }
  return {
    file: match[1],
    line: parseInt(match[2]),
    column: parseInt(match[3]),
  };
}

export function parseErrorStack(stack: string): ParsedErrorStackFrame[] {
  const match = stack.match(/^\s+at .*/ms);
  assert(match !== null, "Could not find stacktrace start in error stack");
  return match[0].split("\n").slice(1).map(parseStackFrame);
}

/**
 * Source file path defined in {@link CallSite} and ${@link ParsedErrorStackFrame} is absolute and is
 * harder to read in logs and stack traces. Here we try to heuristicaly shorten it to relative path
 */
export function shortenSourcePath(path: string): string {
  const parts = split(path);
  const srcIndex = parts.lastIndexOf("src");
  if (srcIndex == -1) return path;
  return join(...parts.slice(srcIndex - 1));
}
