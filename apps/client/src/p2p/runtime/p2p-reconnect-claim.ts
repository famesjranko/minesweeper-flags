import type { GameClientScheduler } from "../../app/providers/game-client.controller.js";
import type { P2PRendezvousClient } from "../signaling/p2p-rendezvous-client.js";
import {
  isAbortError,
  isReconnectClaimInactiveError,
  isReconnectRecoveryUnavailableError
} from "./p2p-runtime-errors.js";

const RECONNECT_HEARTBEAT_INTERVAL_MS = 3_000;
const DIRECT_MATCH_AUTHORITATIVE_MESSAGE =
  "You now have control. This direct match is active in this tab.";
const DIRECT_MATCH_CLAIM_ACTIVE_MESSAGE = "Reconnected. You now have an active claim.";

export interface ActiveReconnectClaimState {
  controlSessionId: string;
  role: "host" | "guest";
  secret: string;
  instanceId: string;
  roomCode: string | null;
  timerId: number | null;
}

export interface ReconnectClaimHeartbeatOptions {
  rendezvousClient: Pick<P2PRendezvousClient, "claimReconnectRole" | "heartbeatReconnectRole">;
  scheduler: GameClientScheduler;
  setError: (message: string) => void;
  onClaimLost: (claim: ActiveReconnectClaimState) => void;
  onRecoveryUnavailable: (claim: ActiveReconnectClaimState) => void;
}

const isSameClaim = (left: ActiveReconnectClaimState, right: ActiveReconnectClaimState): boolean =>
  left.controlSessionId === right.controlSessionId &&
  left.role === right.role &&
  left.secret === right.secret &&
  left.instanceId === right.instanceId;

// Holds this tab's reconnect role claim on the signaling service and keeps it alive.
// Signaling decides which tab owns a role; losing the claim hands control to another tab.
export class ReconnectClaimHeartbeat {
  private activeClaim: ActiveReconnectClaimState | null = null;
  private lastClaimWasVictory = false;

  constructor(private readonly options: ReconnectClaimHeartbeatOptions) {}

  async ensure(claim: ActiveReconnectClaimState, signal?: AbortSignal): Promise<void> {
    if (this.activeClaim && isSameClaim(this.activeClaim, claim)) {
      return;
    }

    await this.options.rendezvousClient.claimReconnectRole(
      claim.controlSessionId,
      claim.role,
      claim.secret,
      claim.instanceId,
      signal
    );
    this.start(claim);
  }

  start(claim: ActiveReconnectClaimState): void {
    const existingClaim = this.activeClaim;

    if (existingClaim && isSameClaim(existingClaim, claim)) {
      return;
    }

    const wasDisplaced = existingClaim !== null && this.lastClaimWasVictory === false;
    const isNewClaim =
      existingClaim === null || existingClaim.controlSessionId !== claim.controlSessionId;

    this.stop();
    this.activeClaim = claim;
    this.lastClaimWasVictory = true;

    if (wasDisplaced || (isNewClaim && existingClaim !== null)) {
      const message =
        claim.role === "host"
          ? DIRECT_MATCH_AUTHORITATIVE_MESSAGE
          : DIRECT_MATCH_CLAIM_ACTIVE_MESSAGE;
      this.options.setError(message);
    }

    this.schedule(claim);
  }

  stop(): void {
    const activeClaim = this.activeClaim;

    if (activeClaim && activeClaim.timerId !== null) {
      this.options.scheduler.clearTimeout(activeClaim.timerId);
    }

    this.activeClaim = null;
  }

  // Stops the heartbeat after signaling took the claim away or dropped the session.
  release(): void {
    this.stop();
    this.lastClaimWasVictory = false;
  }

  handleFailure(claim: ActiveReconnectClaimState, error: unknown): void {
    if (isReconnectClaimInactiveError(error)) {
      this.options.onClaimLost(claim);
      return;
    }

    if (isReconnectRecoveryUnavailableError(error)) {
      this.options.onRecoveryUnavailable(claim);
      return;
    }

    this.schedule(claim);
  }

  private schedule(claim: ActiveReconnectClaimState): void {
    if (this.activeClaim !== claim) {
      return;
    }

    claim.timerId = this.options.scheduler.setTimeout(() => {
      claim.timerId = null;
      void this.run(claim);
    }, RECONNECT_HEARTBEAT_INTERVAL_MS);
  }

  private async run(claim: ActiveReconnectClaimState): Promise<void> {
    if (this.activeClaim !== claim) {
      return;
    }

    try {
      const response = await this.options.rendezvousClient.heartbeatReconnectRole(
        claim.controlSessionId,
        claim.role,
        claim.secret,
        claim.instanceId
      );

      if (this.activeClaim !== claim) {
        return;
      }

      const activeRole = response[claim.role];

      if (activeRole.claimStatus !== "claimed" || activeRole.instanceId !== claim.instanceId) {
        this.options.onClaimLost(claim);
        return;
      }

      this.schedule(claim);
    } catch (error) {
      if (this.activeClaim !== claim || isAbortError(error)) {
        return;
      }

      this.handleFailure(claim, error);
    }
  }
}
