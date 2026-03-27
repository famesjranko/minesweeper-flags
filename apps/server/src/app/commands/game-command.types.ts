import type { RoomStreamEvent, ServerEvent } from "@minesweeper-flags/shared";
import type { PlayerSession } from "../realtime/player-session.service.js";

export type CommandDeliveryStep =
  | {
      kind: "direct";
      event: ServerEvent;
    }
  | {
      kind: "broadcast";
      roomCode: string;
      event: RoomStreamEvent;
    };

export interface CommandExecution {
  sessionToBind?: PlayerSession;
  steps: CommandDeliveryStep[];
}

export const createDirectStep = (event: ServerEvent): CommandDeliveryStep => ({
  kind: "direct",
  event
});

export const createBroadcastStep = (
  roomCode: string,
  event: RoomStreamEvent
): CommandDeliveryStep => ({
  kind: "broadcast",
  roomCode,
  event
});
