export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export interface Logger {
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  debug(msg: string): void;
}

const ORDER: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

/** Logs to stderr so stdout stays clean for reports. */
export function createLogger(level: LogLevel): Logger {
  const at = (l: Exclude<LogLevel, "silent">) => (msg: string) => {
    if (ORDER[level] >= ORDER[l]) process.stderr.write(`[${l}] ${msg}\n`);
  };
  return { error: at("error"), warn: at("warn"), info: at("info"), debug: at("debug") };
}

export const silentLogger: Logger = createLogger("silent");
