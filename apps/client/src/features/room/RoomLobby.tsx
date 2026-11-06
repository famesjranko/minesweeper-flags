import "./room-lobby.css";

import { type BoardSize, DEFAULT_OFFERED_BOARD_SIZE } from "@minesweeper-flags/game-engine";
import { useEffect, useId, useState } from "react";
import type { SlotAvailability } from "../../app/providers/GameClientProvider.js";
import type { DeploymentMode } from "../../lib/config/env.js";
import { DEFAULT_GUEST_NAME, DEFAULT_HOST_NAME } from "./default-names.js";
import { extractInviteToken } from "./invite-link.js";
import {
  DirectMatchActionCards,
  ServerMatchActionCards,
  SlotIndicator
} from "./LobbyActionCards.js";
import { ServerUnreachableNotice } from "./ServerUnreachableNotice.js";

interface RoomLobbyProps {
  connectionStatus: string;
  deploymentMode: DeploymentMode;
  error: string | null;
  initialInviteValue?: string;
  slotAvailability?: SlotAvailability | null;
  serverUnreachable?: boolean;
  onRefreshSlots?: () => void;
  onCreateRoom: (displayName: string, boardSize: BoardSize) => void;
  onJoinRoom: (displayName: string, inviteToken: string) => void;
}

export const RoomLobby = ({
  connectionStatus,
  deploymentMode,
  error,
  initialInviteValue = "",
  slotAvailability = null,
  serverUnreachable = false,
  onRefreshSlots,
  onCreateRoom,
  onJoinRoom
}: RoomLobbyProps) => {
  const displayNameId = useId();
  const [editedName, setEditedName] = useState<string | null>(null);
  const [boardSize, setBoardSize] = useState<BoardSize>(DEFAULT_OFFERED_BOARD_SIZE);
  const [inviteValue, setInviteValue] = useState(initialInviteValue);
  const [inviteChecked, setInviteChecked] = useState(false);
  const inviteToken = extractInviteToken(inviteValue);
  // The visible room code is not a credential: joining needs the token, which cannot be guessed.
  const inviteProblem =
    inviteChecked && inviteValue.trim() && !inviteToken
      ? "That isn’t an invite code. Paste the link your friend sent."
      : null;
  // Until the player types a name, the field shows the default for the seat they are heading to.
  const displayName = editedName ?? (inviteToken ? DEFAULT_GUEST_NAME : DEFAULT_HOST_NAME);
  const trimmedDisplayName = displayName.trim();
  const slotsFull =
    slotAvailability !== null && slotAvailability.activeRooms >= slotAvailability.maxRooms;
  const isP2PDeployment = deploymentMode === "p2p";
  const isServerConnected = isP2PDeployment || connectionStatus === "connected";
  const canCreateRoom = trimmedDisplayName.length > 0 && !slotsFull && isServerConnected;
  const canJoinRoom = trimmedDisplayName.length > 0 && inviteToken !== null && isServerConnected;

  const handleCreateRoom = () => {
    if (!canCreateRoom) {
      return;
    }

    onCreateRoom(trimmedDisplayName, boardSize);
    onRefreshSlots?.();
  };

  const handleJoinRoom = () => {
    setInviteChecked(true);

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
              onRefreshSlots={onRefreshSlots}
            />
          )}
        </div>

        <div className="field lobby-field">
          <input
            id={displayNameId}
            value={displayName}
            onChange={(event) => setEditedName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (inviteValue.trim()) handleJoinRoom();
              else handleCreateRoom();
            }}
            maxLength={20}
            placeholder="Enter your display name"
          />
        </div>
      </div>

      {serverUnreachable ? <ServerUnreachableNotice /> : null}

      <div className="lobby-action-cards">
        {isP2PDeployment ? (
          <DirectMatchActionCards
            canCreateRoom={canCreateRoom}
            onCreateRoom={handleCreateRoom}
            boardSize={boardSize}
            onBoardSizeChange={setBoardSize}
          />
        ) : (
          <ServerMatchActionCards
            canCreateRoom={canCreateRoom}
            onCreateRoom={handleCreateRoom}
            boardSize={boardSize}
            onBoardSizeChange={setBoardSize}
            slotsFull={slotsFull}
            inviteValue={inviteValue}
            onInviteValueChange={(value) => {
              setInviteValue(value);
              setInviteChecked(false);
            }}
            inviteProblem={inviteProblem}
            onInviteChecked={() => setInviteChecked(true)}
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
