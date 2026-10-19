import { MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import { useEffect, useRef, useState } from "react";
import type { SlotAvailability } from "../../app/providers/GameClientProvider.js";
import type { DeploymentMode } from "../../lib/config/env.js";
import { extractInviteToken } from "./invite-link.js";
import { DirectMatchActionCards, ServerMatchActionCards } from "./LobbyActionCards.js";
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

const getStatusNote = (isP2PDeployment: boolean, canJoinRoom: boolean): string => {
  if (isP2PDeployment) {
    return "Direct matches stay in the browser. Hosts share one link and guests join from that link.";
  }

  return canJoinRoom
    ? "Invite looks valid. Press Join Match."
    : "Paste an invite token to unlock Join Match.";
};

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
  const canCreateRoom = trimmedDisplayName.length > 0 && !slotsFull;
  const canJoinRoom = trimmedDisplayName.length > 0 && inviteToken !== null;
  const isP2PDeployment = deploymentMode === "p2p";

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
    <section className="panel hero-panel lobby-panel">
      <div className="hero-copy">
        <p className="eyebrow">MSN-style competitive minesweeper</p>
        <h1>Minesweeper Flags</h1>
        <p>
          Pick hidden squares on a shared 16x16 field. Mines are claimed for points, safe squares
          reveal clues, and the first player to 26 flags wins.
        </p>
      </div>

      <div className="lobby-stage">
        <LobbyPreviewPanel
          title="Classic duel board"
          badge="2 players"
          featurePills={[
            "Shared 16x16 field",
            "First to 26 mines",
            `One comeback bomb at down ${MIN_BOMB_DEFICIT}+`
          ]}
        />

        <section className="lobby-control-panel">
          <div className="lobby-identity-card">
            <div className="lobby-card-heading">
              <h2>Get Ready</h2>
              <span className={`lobby-connection-pill is-${connectionStatus}`}>
                {connectionStatus}
              </span>
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
                slotAvailability={slotAvailability}
                slotsFull={slotsFull}
                refreshing={refreshing}
                onRefreshSlots={handleRefreshSlots}
                inviteValue={inviteValue}
                onInviteValueChange={setInviteValue}
                canJoinRoom={canJoinRoom}
                onJoinRoom={handleJoinRoom}
              />
            )}
          </div>
        </section>
      </div>

      <div className="status-strip lobby-status-strip">
        <span className="lobby-status-note">
          No account needed. Open two tabs or invite a friend.
        </span>
        <span className="lobby-status-note">{getStatusNote(isP2PDeployment, canJoinRoom)}</span>
        {error ? <span className="error-text">{error}</span> : null}
      </div>
    </section>
  );
};
