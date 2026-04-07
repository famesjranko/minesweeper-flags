import type { P2PSetupSnapshot } from "../setup/p2p-setup.types.js";

export interface P2PRuntimeController {
  openGuestSetupSession: (sessionId: string) => void;
  openGuestSetupFromFragment: (fragment: string) => void;
  createGuestAnswer: (displayName: string) => void;
  setHostGuestAnswerText: (value: string) => void;
  applyHostGuestAnswer: () => boolean;
  clearHostSetupError: () => void;
  clearGuestSetupError: () => void;
}

export interface P2PRuntimeSupport {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => P2PSetupSnapshot;
  controller: P2PRuntimeController;
}
