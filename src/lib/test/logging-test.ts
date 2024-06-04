import { asInstanceOf, assert, assertDeepEqual } from "@sergei-dyshel/typescript/error";
import { red, underline } from "../ansi-color";
import { CallSite, getCallsite } from "../callsites";
import { libraryLogger } from "../internal";
import {
  ConsoleAppender,
  InstanceLogger,
  LogFormat,
  LogFormatter,
  LogLevel,
  ModuleLogger,
  configureLogging,
  getLogHandlers,
  type LogHandler,
} from "../logging";

function dateInjection() {
  // month is zero-based!
  return new Date(2020, 0, 1, 13, 30, 20, 500);
}

const DATE = "2020-01-01";
const TIME = "13:30:20";

const FILE = "logging-test.ts";
const MODULE = "qcfg-js-node.logging-test";

type LogLine = [msg?: string, ..._: unknown[]];

class MyConsoleAppender extends ConsoleAppender {
  lastAppended?: LogLine = undefined;

  override append(logLine: string, args?: unknown[]) {
    this.lastAppended = [logLine, ...(args ?? [])];
    super.append(logLine, args);
  }

  verifyAppended(f: () => unknown, line: LogLine) {
    this.lastAppended = undefined;
    f();
    assert(this.lastAppended, "Nothing was appended to log");
    assertDeepEqual(this.lastAppended, line);
  }

  verifyNotAppended(f: () => unknown) {
    this.lastAppended = undefined;
    f();
    assert(
      !this.lastAppended,
      "Something was appended to log while it shouldn't have been",
      this.lastAppended,
    );
  }
}

function main() {
  let msg: string;
  const appender = new MyConsoleAppender();
  configureLogging({
    handler: { formatter: { template: LogFormat.FULL }, appenders: [appender] },
  });
  const logger = new ModuleLogger({ parent: libraryLogger, now: dateInjection });

  msg = "Verifying full log format";
  appender.verifyAppended(() => {
    logger.debug(msg);
  }, [
    `${DATE} ${TIME} DEBUG ${FILE}:${getCallsite().line - 2} ${CallSite.ANONYMOUS}() [${MODULE}] ${msg}`,
  ]);

  msg = "Testing custom prefix";
  const handler = getLogHandlers()[0] as LogHandler;
  const formatter = asInstanceOf(handler.formatter, LogFormatter);
  formatter.options = { template: ["MyLogger", LogFormat.message] };
  appender.verifyAppended(() => {
    logger.debug(msg);
  }, [`MyLogger ${msg}`]);

  msg = "Log level should be red";
  formatter.options = {
    template: [LogFormat.level, LogFormat.message],
    format: { level: { error: { colorizeLevel: red } } },
  };
  appender.verifyAppended(() => {
    logger.error(msg);
  }, [`${red("ERROR")} ${msg}`]);

  msg = "File should underlined and the whole line should be red";
  formatter.options = {
    template: [LogFormat.location, LogFormat.message],
    format: { level: { error: { colorizeLine: red } }, location: { fileColor: underline } },
  };
  appender.verifyAppended(() => {
    logger.error(msg);
  }, [red(`${underline(FILE)}:${getCallsite().line - 1} ${msg}`)]);

  msg = "Sub-module logger";
  const submodule = "submodule";
  const subModuleLogger = new ModuleLogger({ parent: logger, name: submodule });
  formatter.options = {
    template: [LogFormat.module, LogFormat.message],
  };
  appender.verifyAppended(() => {
    subModuleLogger.info(msg);
  }, [`[${MODULE}.${submodule}] ${msg}`]);

  appender.verifyNotAppended(() => {
    logger.level = LogLevel.INFO;
    logger.debug("This should not be logged because of logger level");
    logger.level = undefined;
  });

  appender.verifyNotAppended(() => {
    handler.level = LogLevel.INFO;
    logger.debug("This should not be logged because of handler level");
    handler.level = undefined;
  });

  msg = "Example of instance logger";
  const instance = "instance";
  const instanceLogger = new InstanceLogger(instance, { parent: logger, now: dateInjection });
  formatter.options = {
    template: [LogFormat.instance, LogFormat.message],
  };
  appender.verifyAppended(() => {
    instanceLogger.debug(msg);
  }, [`{${instance}} ${msg}`]);

  const error = new Error("Some error");
  const cause = new Error("Cause of the error");
  error.cause = cause;
  (() => {
    logger.logError(error);
  })();
}

main();
