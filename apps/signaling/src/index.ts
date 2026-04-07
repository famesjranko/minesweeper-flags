import {
  HOST,
  P2P_SIGNALING_MAX_PAYLOAD_BYTES,
  P2P_SIGNALING_SESSION_TTL_SECONDS,
  PORT,
  REDIS_KEY_PREFIX,
  REDIS_URL,
  SIGNALING_ALLOWED_ORIGINS,
  SIGNALING_ANSWER_RATE_LIMIT_MAX,
  SIGNALING_ANSWER_RATE_LIMIT_WINDOW_MS,
  SIGNALING_CREATE_RATE_LIMIT_MAX,
  SIGNALING_CREATE_RATE_LIMIT_WINDOW_MS,
  SIGNALING_RECONNECT_RATE_LIMIT_MAX,
  SIGNALING_RECONNECT_RATE_LIMIT_WINDOW_MS,
  STATE_BACKEND,
  TRUST_PROXY
} from "./config/env.js";
import { createSignalingServer } from "./http/signaling.server.js";
import {
  InMemorySignalingRepository,
  RedisSignalingRepository,
  type SignalingRepository
} from "./modules/signaling/signaling.repository.js";
import { SignalingService } from "./modules/signaling/signaling.service.js";
import { createSignalingRedisClient } from "./state/redis-client.js";

const listen = async (server: ReturnType<typeof createSignalingServer>): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.httpServer.once("error", reject);
    server.httpServer.listen(PORT, HOST, () => {
      server.httpServer.off("error", reject);
      resolve();
    });
  });
};

const main = async (): Promise<void> => {
  let cleanup: (() => Promise<void>) | undefined;
  let repository: SignalingRepository;

  if (STATE_BACKEND === "redis") {
    if (!REDIS_URL) {
      throw new Error("REDIS_URL is required when STATE_BACKEND=redis.");
    }

    const redisClient = await createSignalingRedisClient(REDIS_URL);
    repository = new RedisSignalingRepository(redisClient, REDIS_KEY_PREFIX);
    cleanup = async () => {
      await redisClient.close();
    };
  } else {
    repository = new InMemorySignalingRepository();
  }

  const service = new SignalingService(repository, {
    sessionTtlSeconds: P2P_SIGNALING_SESSION_TTL_SECONDS
  });
  const server = createSignalingServer({
    service,
    maxPayloadBytes: P2P_SIGNALING_MAX_PAYLOAD_BYTES,
    trustProxy: TRUST_PROXY,
    allowedOrigins: SIGNALING_ALLOWED_ORIGINS,
    createRateLimit: {
      maxEvents: SIGNALING_CREATE_RATE_LIMIT_MAX,
      windowMs: SIGNALING_CREATE_RATE_LIMIT_WINDOW_MS
    },
    answerRateLimit: {
      maxEvents: SIGNALING_ANSWER_RATE_LIMIT_MAX,
      windowMs: SIGNALING_ANSWER_RATE_LIMIT_WINDOW_MS
    },
    reconnectRateLimit: {
      maxEvents: SIGNALING_RECONNECT_RATE_LIMIT_MAX,
      windowMs: SIGNALING_RECONNECT_RATE_LIMIT_WINDOW_MS
    }
  });

  const shutdown = async (): Promise<void> => {
    await server.shutdown();
    await cleanup?.();
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  await listen(server);
  server.markReady();
  console.log(`signaling listening on http://${HOST}:${PORT}`);
};

void main();
