import { createId } from "../../lib/ids/id.js";
import type { RoomPlayer } from "../../modules/rooms/room.types.js";
import type { RedisStateClient } from "../state/redis-state-client.js";
import { deserializePlayerSession, serializePlayerSession } from "../state/state-codec.js";

export interface PlayerSession {
  sessionToken: string;
  roomCode: string;
  playerId: string;
  displayName: string;
}

export interface PlayerSessionStore {
  save(session: PlayerSession): Promise<void>;
  getByToken(sessionToken: string): Promise<PlayerSession | undefined>;
  deleteByRoomCode(roomCode: string): Promise<void>;
  touch(session: PlayerSession): Promise<void>;
}

export class InMemoryPlayerSessionStore implements PlayerSessionStore {
  private readonly sessionsByToken = new Map<string, PlayerSession>();

  async save(session: PlayerSession): Promise<void> {
    this.sessionsByToken.set(session.sessionToken, session);
  }

  async getByToken(sessionToken: string): Promise<PlayerSession | undefined> {
    return this.sessionsByToken.get(sessionToken);
  }

  async deleteByRoomCode(roomCode: string): Promise<void> {
    for (const [sessionToken, session] of this.sessionsByToken) {
      if (session.roomCode === roomCode) {
        this.sessionsByToken.delete(sessionToken);
      }
    }
  }

  async touch(session: PlayerSession): Promise<void> {
    this.sessionsByToken.set(session.sessionToken, session);
  }
}

export class RedisPlayerSessionStore implements PlayerSessionStore {
  constructor(
    private readonly redis: RedisStateClient,
    private readonly keyPrefix: string,
    private readonly sessionTtlSeconds: number
  ) {}

  async save(session: PlayerSession): Promise<void> {
    const existingSession = await this.getByToken(session.sessionToken);

    await this.redis.executeTransaction([
      {
        type: "set",
        key: this.sessionKey(session.sessionToken),
        value: serializePlayerSession(session),
        options: {
          expireInSeconds: this.sessionTtlSeconds
        }
      },
      {
        type: "sAdd",
        key: this.roomSessionsKey(session.roomCode),
        members: [session.sessionToken]
      },
      {
        type: "expire",
        key: this.roomSessionsKey(session.roomCode),
        seconds: this.sessionTtlSeconds
      },
      {
        type: "sRem",
        key: existingSession ? this.roomSessionsKey(existingSession.roomCode) : this.roomSessionsKey(session.roomCode),
        members:
          existingSession && existingSession.roomCode !== session.roomCode
            ? [session.sessionToken]
            : []
      }
    ]);
  }

  async getByToken(sessionToken: string): Promise<PlayerSession | undefined> {
    const storedSession = await this.redis.get(this.sessionKey(sessionToken));

    return storedSession ? deserializePlayerSession(storedSession) : undefined;
  }

  async deleteByRoomCode(roomCode: string): Promise<void> {
    const roomSessionsKey = this.roomSessionsKey(roomCode);
    const sessionTokens = await this.redis.sMembers(roomSessionsKey);

    await this.redis.executeTransaction([
      {
        type: "del",
        keys: [
          ...sessionTokens.map((sessionToken) => this.sessionKey(sessionToken)),
          roomSessionsKey
        ]
      }
    ]);
  }

  async touch(session: PlayerSession): Promise<void> {
    await this.redis.executeTransaction([
      {
        type: "set",
        key: this.sessionKey(session.sessionToken),
        value: serializePlayerSession(session),
        options: {
          expireInSeconds: this.sessionTtlSeconds
        }
      },
      {
        type: "sAdd",
        key: this.roomSessionsKey(session.roomCode),
        members: [session.sessionToken]
      },
      {
        type: "expire",
        key: this.roomSessionsKey(session.roomCode),
        seconds: this.sessionTtlSeconds
      }
    ]);
  }

  private sessionKey(sessionToken: string): string {
    return `${this.keyPrefix}:sessions:records:${sessionToken}`;
  }

  private roomSessionsKey(roomCode: string): string {
    return `${this.keyPrefix}:sessions:room-index:${roomCode}`;
  }
}

export class PlayerSessionService {
  constructor(
    private readonly playerSessionStore: PlayerSessionStore = new InMemoryPlayerSessionStore()
  ) {}

  async createSession(roomCode: string, player: RoomPlayer): Promise<PlayerSession> {
    const session: PlayerSession = {
      sessionToken: createId(),
      roomCode,
      playerId: player.playerId,
      displayName: player.displayName
    };

    await this.playerSessionStore.save(session);
    return session;
  }

  async requireSession(roomCode: string, sessionToken: string): Promise<PlayerSession> {
    const session = await this.playerSessionStore.getByToken(sessionToken);

    if (!session || session.roomCode !== roomCode) {
      throw new Error("That session is not valid for this room.");
    }

    await this.playerSessionStore.touch(session);
    return session;
  }

  async refreshSession(session: PlayerSession): Promise<void> {
    await this.playerSessionStore.touch(session);
  }

  async revokeRoomSessions(roomCode: string): Promise<void> {
    await this.playerSessionStore.deleteByRoomCode(roomCode);
  }
}
