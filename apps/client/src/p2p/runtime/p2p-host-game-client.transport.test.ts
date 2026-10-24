import { CLIENT_EVENT_NAMES } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import { P2PHostOrchestrator } from "../host/p2p-host-orchestrator.js";
import type { WebRTCPeerController } from "../transport/webrtc-peer.types.js";
import { P2PHostGameClientTransport } from "./p2p-host-game-client.transport.js";

const unusedSignal = (): never => {
  throw new Error("Signaling is not used by this test.");
};

const createIdlePeer = (): WebRTCPeerController => ({
  disconnect: () => {},
  getStatus: () => "idle",
  send: () => {},
  subscribe: () => () => {},
  createHostOffer: unusedSignal,
  createGuestAnswer: unusedSignal,
  applyGuestAnswer: unusedSignal,
  createReconnectOffer: unusedSignal,
  createReconnectAnswer: unusedSignal,
  applyReconnectAnswer: unusedSignal
});

describe("P2PHostGameClientTransport", () => {
  it("creates the host room with the board size from the room create event", () => {
    // Given a host transport over an orchestrator with no room
    let id = 0;
    const orchestrator = new P2PHostOrchestrator({
      now: () => 100,
      identityFactory: {
        createId: () => `id-${++id}`,
        createRoomCode: () => "ROOM1",
        createInviteToken: () => "invite_token_value_1"
      }
    });
    const transport = new P2PHostGameClientTransport(orchestrator, createIdlePeer());

    // When the host client sends a room create event for a huge board
    transport.send({
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: { displayName: "Host", boardSize: "huge" }
    });

    // Then the host room records the huge board
    expect(orchestrator.getState().room?.boardSize).toBe("huge");
  });
});
