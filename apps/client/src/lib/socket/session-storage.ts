export interface StoredSession {
  roomId: string;
  roomCode: string;
  playerId: string;
  displayName: string;
  sessionToken: string;
}

const createSessionKey = (roomCode: string) => `msf:session:${roomCode}`;

export const storeSession = (session: StoredSession): void => {
  window.localStorage.setItem(createSessionKey(session.roomCode), JSON.stringify(session));
};

export const removeStoredSession = (roomCode: string): void => {
  window.localStorage.removeItem(createSessionKey(roomCode));
};

export const getStoredSession = (roomCode: string): StoredSession | null => {
  const value = window.localStorage.getItem(createSessionKey(roomCode));

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as StoredSession;
  } catch {
    removeStoredSession(roomCode);
    return null;
  }
};
