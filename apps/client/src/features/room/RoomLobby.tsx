import "./room-lobby.css";

import { useEffect, useId, useRef, useState } from "react";
import type { SlotAvailability } from "../../app/providers/GameClientProvider.js";
import type { DeploymentMode } from "../../lib/config/env.js";
import { extractInviteToken } from "./invite-link.js";
import {
  DirectMatchActionCards,
  ServerMatchActionCards,
  SlotIndicator
} from "./LobbyActionCards.js";

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
  const displayNameId = useId();
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
    <section className="arcade-lobby lobby-form">
      <div className="lobby-identity-card">
        <div className="lobby-identity-heading">
          <label htmlFor={displayNameId}>Display name</label>
          {!isP2PDeployment && slotAvailability !== null && (
            <SlotIndicator
              slotAvailability={slotAvailability}
              slotsFull={slotsFull}
              refreshing={refreshing}
              onRefreshSlots={handleRefreshSlots}
            />
          )}
        </div>

        <div className="field lobby-field">
          <input
            id={displayNameId}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={20}
            placeholder="Enter your display name"
          />
        </div>
      </div>

      <div className="lobby-action-cards">
        {isP2PDeployment ? (
          <DirectMatchActionCards canCreateRoom={canCreateRoom} onCreateRoom={handleCreateRoom} />
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
      {error ? (
        <p className="arcade-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
