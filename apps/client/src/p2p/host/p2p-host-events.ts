import type { ServerEvent } from "@minesweeper-flags/shared";

export type P2PHostFanoutTarget = "host-local" | "guest" | "broadcast";

export interface P2PHostFanoutStep {
  target: P2PHostFanoutTarget;
  event: ServerEvent;
}

export interface P2PHostEventSink {
  deliverToHostLocal?: (event: ServerEvent) => void;
  deliverToGuest?: (event: ServerEvent) => void;
}

export const createHostLocalFanoutStep = (event: ServerEvent): P2PHostFanoutStep => ({
  target: "host-local",
  event
});

export const createGuestFanoutStep = (event: ServerEvent): P2PHostFanoutStep => ({
  target: "guest",
  event
});

export const createBroadcastFanoutStep = (event: ServerEvent): P2PHostFanoutStep => ({
  target: "broadcast",
  event
});

export const emitP2PHostFanout = (
  steps: readonly P2PHostFanoutStep[],
  sink: P2PHostEventSink
): void => {
  for (const step of steps) {
    if (step.target === "host-local") {
      sink.deliverToHostLocal?.(step.event);
      continue;
    }

    if (step.target === "guest") {
      sink.deliverToGuest?.(step.event);
      continue;
    }

    sink.deliverToHostLocal?.(step.event);
    sink.deliverToGuest?.(step.event);
  }
};
