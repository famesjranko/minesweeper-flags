export interface FixedWindowLimit {
  maxEvents: number;
  windowMs: number;
}

/**
 * Each bucket limits one class of signaling request per client IP.
 * "reconnect" also covers every post-create read and write on invite sessions.
 */
export type SignalingRateLimitBucket = "create" | "answer" | "reconnect";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  retryAfterMs: number;
}

interface RateLimitWindow {
  timestamps: number[];
  windowMs: number;
}

export class SignalingHttpAbusePrevention {
  private readonly windowsByKey = new Map<string, RateLimitWindow>();
  private readonly cleanupIntervalMs: number;
  private nextCleanupAt = 0;

  constructor(private readonly limits: Record<SignalingRateLimitBucket, FixedWindowLimit>) {
    this.cleanupIntervalMs = Math.max(
      limits.create.windowMs,
      limits.answer.windowMs,
      limits.reconnect.windowMs
    );
  }

  consume(bucket: SignalingRateLimitBucket, ipAddress: string, now = Date.now()): RateLimitResult {
    const limit = this.limits[bucket];
    const windowKey = `${bucket}:${ipAddress.trim() || "unknown"}`;

    this.pruneExpiredWindows(now);

    const cutoff = now - limit.windowMs;
    const window = this.windowsByKey.get(windowKey);
    const activeTimestamps = (window?.timestamps ?? []).filter((timestamp) => timestamp > cutoff);

    if (activeTimestamps.length >= limit.maxEvents) {
      const oldestTimestamp = activeTimestamps[0] ?? now;

      this.windowsByKey.set(windowKey, {
        timestamps: activeTimestamps,
        windowMs: limit.windowMs
      });

      return {
        allowed: false,
        limit: limit.maxEvents,
        retryAfterMs: Math.max(0, oldestTimestamp + limit.windowMs - now)
      };
    }

    activeTimestamps.push(now);
    this.windowsByKey.set(windowKey, {
      timestamps: activeTimestamps,
      windowMs: limit.windowMs
    });

    return {
      allowed: true,
      limit: limit.maxEvents,
      retryAfterMs: 0
    };
  }

  private pruneExpiredWindows(now: number): void {
    if (now < this.nextCleanupAt) {
      return;
    }

    this.nextCleanupAt = now + this.cleanupIntervalMs;

    for (const [windowKey, window] of this.windowsByKey) {
      const activeTimestamps = window.timestamps.filter(
        (timestamp) => timestamp > now - window.windowMs
      );

      if (activeTimestamps.length === 0) {
        this.windowsByKey.delete(windowKey);
        continue;
      }

      this.windowsByKey.set(windowKey, {
        ...window,
        timestamps: activeTimestamps
      });
    }
  }
}
