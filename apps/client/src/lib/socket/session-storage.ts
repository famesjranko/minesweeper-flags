export interface StoredSession {
  roomId: string;
  roomCode: string;
  inviteToken?: string;
  playerId: string;
  displayName: string;
  sessionToken: string;
}

const createSessionKey = (roomCode: string) => `msf:session:${roomCode}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeStoredSession = (value: unknown): StoredSession | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { roomId, roomCode, inviteToken, playerId, displayName, sessionToken } = value;

  if (
    typeof roomId !== "string" ||
    typeof roomCode !== "string" ||
    typeof playerId !== "string" ||
    typeof displayName !== "string" ||
    typeof sessionToken !== "string"
  ) {
    return null;
  }

  return {
    roomId,
    roomCode,
    ...(typeof inviteToken === "string" ? { inviteToken } : {}),
    playerId,
    displayName,
    sessionToken
  };
};

const serializeStoredSession = (session: StoredSession): string =>
  JSON.stringify({
    roomId: session.roomId,
    roomCode: session.roomCode,
    ...(session.inviteToken ? { inviteToken: session.inviteToken } : {}),
    playerId: session.playerId,
    displayName: session.displayName,
    sessionToken: session.sessionToken
  } satisfies StoredSession);

export interface SessionPersistence {
  read: (roomCode: string) => StoredSession | null;
  write: (session: StoredSession) => void;
  remove: (roomCode: string) => void;
}

// localStorage throws when storage is full or blocked (private mode, policy).
// A session that cannot be saved must not break the game flow, so failures
// degrade to "nothing stored" instead of propagating.
const tryStorage = <T>(action: () => T, fallback: T): T => {
  try {
    return action();
  } catch {
    return fallback;
  }
};

export const createBrowserSessionPersistence = (): SessionPersistence => ({
  read: (roomCode) => {
    const storageKey = createSessionKey(roomCode);
    const removeInvalid = (): void => {
      tryStorage(() => window.localStorage.removeItem(storageKey), undefined);
    };
    const value = tryStorage(() => window.localStorage.getItem(storageKey), null);

    if (!value) {
      return null;
    }

    try {
      const normalized = normalizeStoredSession(JSON.parse(value));

      if (!normalized) {
        removeInvalid();
      }

      return normalized;
    } catch {
      removeInvalid();
      return null;
    }
  },
  write: (session) => {
    tryStorage(
      () =>
        window.localStorage.setItem(
          createSessionKey(session.roomCode),
          serializeStoredSession(session)
        ),
      undefined
    );
  },
  remove: (roomCode) => {
    tryStorage(() => window.localStorage.removeItem(createSessionKey(roomCode)), undefined);
  }
});

const browserSessionPersistence = createBrowserSessionPersistence();

export const storeSession = (session: StoredSession): void => {
  browserSessionPersistence.write(session);
};

export const removeStoredSession = (roomCode: string): void => {
  browserSessionPersistence.remove(roomCode);
};

export const getStoredSession = (roomCode: string): StoredSession | null => {
  return browserSessionPersistence.read(roomCode);
};
