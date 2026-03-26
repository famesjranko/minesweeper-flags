import { SERVER_HOST, SERVER_PORT, WEBSOCKET_PATH } from "./app/config/env.js";
import { startRealtimeServer } from "./app/realtime/realtime.server.js";
import { logger } from "./lib/logging/logger.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Shutdown timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

try {
  const realtimeServer = await startRealtimeServer({
    host: SERVER_HOST,
    port: SERVER_PORT,
    websocketPath: WEBSOCKET_PATH
  });
  let shuttingDown = false;

  const handleSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      logger.warn("realtime.shutdown_signal_ignored", { signal });
      return;
    }

    shuttingDown = true;

    void (async () => {
      try {
        await withTimeout(
          realtimeServer.shutdown({
            signal,
            timeoutMs: SHUTDOWN_TIMEOUT_MS
          }),
          SHUTDOWN_TIMEOUT_MS + 1_000
        );
        process.exit(0);
      } catch (error) {
        logger.error("realtime.process_shutdown_failed", { signal, error });
        process.exit(1);
      }
    })();
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
} catch (error) {
  logger.error("realtime.process_start_failed", { error });
  process.exit(1);
}
