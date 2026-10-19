import { setPlayerConnection } from "@minesweeper-flags/game-engine";
import {
  createBroadcastFanoutStep,
  createGuestFanoutStep,
  createHostLocalFanoutStep,
  type P2PHostFanoutStep
} from "./p2p-host-events.js";
import {
  buildChatHistoryEvent,
  buildMatchReplayEvent,
  buildMatchStateEvent,
  buildPlayerDisconnectedEvent,
  buildPlayerReconnectedEvent,
  buildRoomJoinedEvent
} from "./p2p-host-server-events.js";
import type { P2PGuestSessionRecord } from "./p2p-host-session.js";
import type { P2PHostRoomRecord, P2PHostRuntimeState } from "./p2p-host-state.js";

export interface P2PGuestConnectionChange {
  state: P2PHostRuntimeState;
  steps: P2PHostFanoutStep[];
}

// Returns the state with the guest's connected flag set, or null when it already was.
const withGuestConnected = (
  state: P2PHostRuntimeState,
  guestPlayerId: string,
  connected: boolean
): P2PHostRuntimeState | null => {
  const guest = state.match?.players.find((player) => player.playerId === guestPlayerId);

  if (!state.match || !guest || guest.connected === connected) {
    return null;
  }

  return { ...state, match: setPlayerConnection(state.match, guestPlayerId, connected) };
};

// The host browser notices the guest's peer drop and plays the server's part: it marks the
// guest offline and tells only itself, because the guest is unreachable. Repeat reports of
// the same drop change nothing.
export const disconnectGuest = (state: P2PHostRuntimeState): P2PGuestConnectionChange => {
  const { room, guestSession } = state;
  const next =
    room && guestSession ? withGuestConnected(state, guestSession.playerId, false) : null;

  if (!room || !guestSession || !next?.match) {
    return { state, steps: [] };
  }

  return {
    state: next,
    steps: [
      createHostLocalFanoutStep(buildPlayerDisconnectedEvent(room.roomCode, guestSession.playerId)),
      createHostLocalFanoutStep(buildMatchStateEvent(room.roomCode, next.match))
    ]
  };
};

// Replays the first-join bootstrap to a guest that reconnects on a new binding, and marks
// it online again for the host.
export const reconnectGuest = (
  state: P2PHostRuntimeState,
  room: P2PHostRoomRecord,
  guestSession: P2PGuestSessionRecord,
  bindingId: string | null
): P2PGuestConnectionChange => {
  const rebound: P2PHostRuntimeState = { ...state, guestSession: { ...guestSession, bindingId } };
  const reconnected = withGuestConnected(rebound, guestSession.playerId, true);
  const next = reconnected ?? rebound;
  const steps: P2PHostFanoutStep[] = [
    createGuestFanoutStep(buildRoomJoinedEvent(room, { ...guestSession, bindingId })),
    createGuestFanoutStep(buildChatHistoryEvent(room.roomCode, next.chatMessages)),
    createBroadcastFanoutStep(buildPlayerReconnectedEvent(room.roomCode, guestSession.playerId))
  ];

  if (next.match) {
    steps.push(createGuestFanoutStep(buildMatchReplayEvent(room.roomCode, next.match)));
  }

  if (reconnected?.match) {
    steps.push(createHostLocalFanoutStep(buildMatchStateEvent(room.roomCode, reconnected.match)));
  }

  return { state: next, steps };
};
