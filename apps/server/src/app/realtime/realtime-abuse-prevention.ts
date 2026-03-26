interface FixedWindowLimit {
  maxEvents: number;
  windowMs: number;
}

interface RealtimeAbusePreventionOptions {
  maxConnectionsPerIp: number;
  roomCreateLimit: FixedWindowLimit;
  roomJoinLimit: FixedWindowLimit;
  invalidMessageLimit: FixedWindowLimit;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
}

export interface ConnectionAdmissionResult {
  allowed: boolean;
  limit: number;
  activeConnections: number;
}

export class RealtimeAbusePrevention {
  private readonly activeConnectionsByIp = new Map<string, number>();
  private readonly timestampsByBucket = new Map<string, number[]>();

  constructor(private readonly options: RealtimeAbusePreventionOptions) {}

  registerConnection(ipAddress: string): ConnectionAdmissionResult {
    const ipKey = this.normalizeIpAddress(ipAddress);
    const nextCount = (this.activeConnectionsByIp.get(ipKey) ?? 0) + 1;

    this.activeConnectionsByIp.set(ipKey, nextCount);

    return {
      allowed: nextCount <= this.options.maxConnectionsPerIp,
      limit: this.options.maxConnectionsPerIp,
      activeConnections: nextCount
    };
  }

  unregisterConnection(ipAddress: string): void {
    const ipKey = this.normalizeIpAddress(ipAddress);
    const activeConnections = this.activeConnectionsByIp.get(ipKey);

    if (!activeConnections) {
      return;
    }

    if (activeConnections === 1) {
      this.activeConnectionsByIp.delete(ipKey);
      return;
    }

    this.activeConnectionsByIp.set(ipKey, activeConnections - 1);
  }

  getActiveConnections(ipAddress: string): number {
    return this.activeConnectionsByIp.get(this.normalizeIpAddress(ipAddress)) ?? 0;
  }

  consumeRoomCreate(ipAddress: string, now = Date.now()): RateLimitResult {
    return this.consume(`room-create:${this.normalizeIpAddress(ipAddress)}`, this.options.roomCreateLimit, now);
  }

  consumeRoomJoin(ipAddress: string, now = Date.now()): RateLimitResult {
    return this.consume(`room-join:${this.normalizeIpAddress(ipAddress)}`, this.options.roomJoinLimit, now);
  }

  recordInvalidMessage(ipAddress: string, now = Date.now()): RateLimitResult {
    return this.consume(
      `invalid-message:${this.normalizeIpAddress(ipAddress)}`,
      this.options.invalidMessageLimit,
      now
    );
  }

  private consume(bucketKey: string, limit: FixedWindowLimit, now: number): RateLimitResult {
    const cutoff = now - limit.windowMs;
    const activeTimestamps = (this.timestampsByBucket.get(bucketKey) ?? []).filter(
      (timestamp) => timestamp > cutoff
    );

    if (activeTimestamps.length >= limit.maxEvents) {
      const oldestTimestamp = activeTimestamps[0] ?? now;

      this.timestampsByBucket.set(bucketKey, activeTimestamps);

      return {
        allowed: false,
        limit: limit.maxEvents,
        remaining: 0,
        retryAfterMs: Math.max(0, oldestTimestamp + limit.windowMs - now)
      };
    }

    activeTimestamps.push(now);
    this.timestampsByBucket.set(bucketKey, activeTimestamps);

    return {
      allowed: true,
      limit: limit.maxEvents,
      remaining: limit.maxEvents - activeTimestamps.length,
      retryAfterMs: 0
    };
  }

  private normalizeIpAddress(ipAddress: string): string {
    return ipAddress.trim() || "unknown";
  }
}
