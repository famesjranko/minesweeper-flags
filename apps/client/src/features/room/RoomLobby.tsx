import "./room-lobby.css";

import { MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import { useEffect, useRef, useState } from "react";
import type { SlotAvailability } from "../../app/providers/GameClientProvider.js";
import type { DeploymentMode } from "../../lib/config/env.js";
import { ArcadeHeader } from "../../shared-ui/ArcadeHeader.js";
import { extractInviteToken } from "./invite-link.js";
import {
  DirectMatchActionCards,
  ServerMatchActionCards,
  SlotIndicator
} from "./LobbyActionCards.js";
import { LobbyPreviewPanel } from "./LobbyPreviewPanel.js";

interface RoomLobbyProps {
  connectionStatus: string;
  deploymentMode: DeploymentMode;
  error: string | null;
  initialInviteValue?: string;
  slotAvailability?: SlotAvailability | null;
  onRefreshSlots?: () => void;
  onCreateRoom: (displayName: string) => void;
  onJoinRoom: (displayName: string, inviteToken: string) => void;
}

export const RoomLobby = ({
  connectionStatus,
  deploymentMode,
  error,
  initialInviteValue = "",
  slotAvailability = null,
  onRefreshSlots,
  onCreateRoom,
  onJoinRoom
}: RoomLobbyProps) => {
  const [displayName, setDisplayName] = useState("Captain Sweeper");
  const [inviteValue, setInviteValue] = useState(initialInviteValue);
  const trimmedDisplayName = displayName.trim();
  const inviteToken = extractInviteToken(inviteValue);
  const slotsFull =
    slotAvailability !== null && slotAvailability.activeRooms >= slotAvailability.maxRooms;
  const isP2PDeployment = deploymentMode === "p2p";
  const isServerConnected = isP2PDeployment || connectionStatus === "connected";
  const canCreateRoom = trimmedDisplayName.length > 0 && !slotsFull && isServerConnected;
  const canJoinRoom = trimmedDisplayName.length > 0 && inviteToken !== null && isServerConnected;

  const [refreshing, setRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    },
    []
  );

  const handleCreateRoom = () => {
    if (!canCreateRoom) {
      return;
    }

    onCreateRoom(trimmedDisplayName);
    onRefreshSlots?.();
  };

  const handleRefreshSlots = () => {
    setRefreshing(true);
    onRefreshSlots?.();
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => setRefreshing(false), 600);
  };

  const handleJoinRoom = () => {
    if (!canJoinRoom || !inviteToken) {
      return;
    }

    onJoinRoom(trimmedDisplayName, inviteToken);
  };

  useEffect(() => {
    if (initialInviteValue) {
      setInviteValue(initialInviteValue);
    }
  }, [initialInviteValue]);

  return (
    <section className="arcade-lobby">
      <ArcadeHeader connectionStatus={connectionStatus} />

      <div className="arcade-introduction">
        <p className="arcade-eyebrow">A Messenger classic</p>
        <h1>
          Find the mines. <span>Win the flags.</span>
        </h1>
        <p className="arcade-description">
          Claim mines on a shared 16×16 board. The first player to 26 wins.
        </p>
      </div>

      <div className="arcade-stage">
        <div className="arcade-illustration" aria-hidden="true">
          <LobbyPreviewPanel title="Classic duel board" badge="2 players" />
          <div className="arcade-board-note">
            <span>51 mines · One shared board</span>
            <span>First to 26</span>
          </div>
        </div>

        <section className="lobby-control-panel">
          <div className="lobby-identity-card">
            <div className="lobby-identity-heading">
              <h2>Play with a friend</h2>
              {!isP2PDeployment && slotAvailability !== null && (
                <SlotIndicator
                  slotAvailability={slotAvailability}
                  slotsFull={slotsFull}
                  refreshing={refreshing}
                  onRefreshSlots={handleRefreshSlots}
                />
              )}
            </div>

            <label className="field lobby-field">
              <span>Display name</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={20}
                placeholder="Enter your display name"
              />
            </label>
          </div>

          <div className="lobby-action-cards">
            {isP2PDeployment ? (
              <DirectMatchActionCards
                canCreateRoom={canCreateRoom}
                onCreateRoom={handleCreateRoom}
              />
            ) : (
              <ServerMatchActionCards
                canCreateRoom={canCreateRoom}
                onCreateRoom={handleCreateRoom}
                slotsFull={slotsFull}
                inviteValue={inviteValue}
                onInviteValueChange={setInviteValue}
                canJoinRoom={canJoinRoom}
                onJoinRoom={handleJoinRoom}
              />
            )}
          </div>
        </section>
      </div>

      {error ? (
        <p className="arcade-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer className="arcade-footer">
        <p>No account needed. Invite a friend.</p>
        <details>
          <summary>How to play</summary>
          <p>
            Take turns choosing squares. A mine scores a point and keeps your turn. A safe square
            ends your turn. Your comeback bomb unlocks when you trail by {MIN_BOMB_DEFICIT} or more.
            {isP2PDeployment ? " Keep the host's browser tab open during a direct match." : null}
          </p>
        </details>
      </footer>
    </section>
  );
};
