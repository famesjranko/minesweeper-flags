import type { BoardSize } from "@minesweeper-flags/game-engine";
import { useEffect, useRef, useState } from "react";
import type { SlotAvailability } from "../../app/providers/GameClientProvider.js";
import { BoardSizeSelect } from "../../shared-ui/BoardSizeSelect.js";

interface CreateActionProps {
  canCreateRoom: boolean;
  onCreateRoom: () => void;
  boardSize: BoardSize;
  onBoardSizeChange: (boardSize: BoardSize) => void;
}

export const DirectMatchActionCards = ({
  canCreateRoom,
  onCreateRoom,
  boardSize,
  onBoardSizeChange
}: CreateActionProps) => (
  <>
    <form
      className="lobby-action-card is-create"
      onSubmit={(event) => {
        event.preventDefault();
        onCreateRoom();
      }}
    >
      <div className="lobby-card-heading">
        <h2>Host Direct Match</h2>
        <span>Create a browser-to-browser match and share one direct link.</span>
      </div>

      <div className="board-size-row">
        <BoardSizeSelect value={boardSize} onChange={onBoardSizeChange} />
        <button
          type="submit"
          className="lobby-action-button lobby-create-button"
          disabled={!canCreateRoom}
        >
          Host direct match
        </button>
      </div>
    </form>

    <div className="lobby-action-card is-join">
      <div className="lobby-card-heading">
        <h2>Join Direct Match</h2>
        <span>Open the host's shared link to load the direct match automatically.</span>
      </div>

      <p className="waiting-room-copy">
        Guests join from the host's direct link. Open that shared link in this browser to connect.
      </p>

      <button className="lobby-action-button lobby-join-button" disabled type="button">
        Join direct match
      </button>
    </div>
  </>
);

interface SlotIndicatorProps {
  slotAvailability: SlotAvailability;
  slotsFull: boolean;
  onRefreshSlots: (() => void) | undefined;
}

export const SlotIndicator = ({
  slotAvailability,
  slotsFull,
  onRefreshSlots
}: SlotIndicatorProps) => {
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

  const handleRefresh = () => {
    setRefreshing(true);
    onRefreshSlots?.();
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <span className="lobby-slot-indicator">
      <span
        className={`lobby-slot-pill${slotsFull ? " is-full" : ""}`}
        role="status"
        aria-label="Rooms in use"
        title={`${slotAvailability.activeRooms} of ${slotAvailability.maxRooms} rooms in use`}
      >
        {slotAvailability.activeRooms}/{slotAvailability.maxRooms} rooms
      </span>
      <button
        type="button"
        className={`lobby-slot-refresh${refreshing ? " is-refreshing" : ""}`}
        onClick={handleRefresh}
        aria-label="Refresh room availability"
        title="Refresh slot count"
      >
        &#x21bb;
      </button>
    </span>
  );
};

interface ServerMatchActionCardsProps extends CreateActionProps {
  slotsFull: boolean;
  inviteValue: string;
  onInviteValueChange: (value: string) => void;
  inviteProblem: string | null;
  onInviteChecked: () => void;
  canJoinRoom: boolean;
  onJoinRoom: () => void;
}

export const ServerMatchActionCards = ({
  canCreateRoom,
  onCreateRoom,
  boardSize,
  onBoardSizeChange,
  slotsFull,
  inviteValue,
  onInviteValueChange,
  inviteProblem,
  onInviteChecked,
  canJoinRoom,
  onJoinRoom
}: ServerMatchActionCardsProps) => (
  <>
    <form
      className="lobby-action-card is-create"
      onSubmit={(event) => {
        event.preventDefault();
        onCreateRoom();
      }}
    >
      <h2 className="arcade-create-heading">Create a Match</h2>

      <div className="board-size-row">
        <BoardSizeSelect value={boardSize} onChange={onBoardSizeChange} />
        <button
          type="submit"
          className="lobby-action-button lobby-create-button"
          disabled={!canCreateRoom}
        >
          Create room
        </button>
      </div>
      <p className="lobby-create-description">
        {slotsFull ? "All room slots are in use." : "Share an invite link with a friend."}
      </p>
    </form>

    <form
      className="lobby-action-card is-join"
      onSubmit={(event) => {
        event.preventDefault();
        onJoinRoom();
      }}
    >
      <div className="lobby-card-heading">
        <h2>Have an invite?</h2>
      </div>

      <div className="lobby-join-entry">
        <label className="field lobby-field">
          <span>Invite link or code</span>
          <input
            className="invite-token-input"
            value={inviteValue}
            onChange={(event) => onInviteValueChange(event.target.value)}
            onBlur={onInviteChecked}
            // A disabled Join stops Enter from submitting the form, so Enter is read here too.
            onKeyDown={(event) => {
              if (event.key === "Enter") onInviteChecked();
            }}
            aria-invalid={inviteProblem ? true : undefined}
            placeholder="Paste an invite link or code"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
          />
        </label>

        <button
          type="submit"
          className={["lobby-action-button", "lobby-join-button", canJoinRoom ? "is-ready" : ""]
            .filter(Boolean)
            .join(" ")}
          disabled={!canJoinRoom}
        >
          Join
        </button>
      </div>
      {inviteProblem ? (
        <p className="arcade-error lobby-invite-problem" role="alert">
          {inviteProblem}
        </p>
      ) : null}
    </form>
  </>
);
