type LogLevel = "info" | "warn" | "error";
type LogMetadata = Record<string, unknown>;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  error?: unknown;
  [key: string]: unknown;
}

const serializeError = (error: unknown): unknown => {
  if (!(error instanceof Error)) {
    return error;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: serializeError(error.cause)
  };
};

const writeLog = (level: LogLevel, messageOrError: string | Error, metadata: LogMetadata = {}): void => {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message: messageOrError instanceof Error ? messageOrError.message : messageOrError
  };

  for (const [key, value] of Object.entries(metadata)) {
    entry[key] = key === "error" ? serializeError(value) : value;
  }

  if (messageOrError instanceof Error) {
    entry.error = serializeError(messageOrError);
  }

  const line = JSON.stringify(entry);

  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    default:
      console.log(line);
      break;
  }
};

export const logger = {
  info: (message: string, metadata?: LogMetadata) => writeLog("info", message, metadata),
  warn: (message: string, metadata?: LogMetadata) => writeLog("warn", message, metadata),
  error: (messageOrError: string | Error, metadata?: LogMetadata) =>
    writeLog("error", messageOrError, metadata)
};
