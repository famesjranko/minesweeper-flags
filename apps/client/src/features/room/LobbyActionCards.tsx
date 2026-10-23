import { INVITE_TOKEN_LENGTH } from "@minesweeper-flags/shared";
import type { SlotAvailability } from "../../app/providers/GameClientProvider.js";

interface CreateActionProps {
  canCreateRoom: boolean;
  onCreateRoom: () => void;
}

export const DirectMatchActionCards = ({ canCreateRoom, onCreateRoom }: CreateActionProps) => (
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

      <button
        type="submit"
        className="lobby-action-button lobby-create-button"
        disabled={!canCreateRoom}
      >
        Host direct match
      </button>
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
  refreshing: boolean;
  onRefreshSlots: () => void;
}

export const SlotIndicator = ({
  slotAvailability,
  slotsFull,
  refreshing,
  onRefreshSlots
}: SlotIndicatorProps) => (
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
      onClick={onRefreshSlots}
      aria-label="Refresh room availability"
      title="Refresh slot count"
    >
      &#x21bb;
    </button>
  </span>
);

interface ServerMatchActionCardsProps extends CreateActionProps {
  slotsFull: boolean;
  inviteValue: string;
  onInviteValueChange: (value: string) => void;
  canJoinRoom: boolean;
  onJoinRoom: () => void;
}

export const ServerMatchActionCards = ({
  canCreateRoom,
  onCreateRoom,
  slotsFull,
  inviteValue,
  onInviteValueChange,
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
      <h3 className="arcade-create-heading">Create a Match</h3>

      <button
        type="submit"
        className="lobby-action-button lobby-create-button"
        disabled={!canCreateRoom}
      >
        Create room
      </button>
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
        <h3>Have an invite?</h3>
      </div>

      <div className="lobby-join-entry">
        <label className="field lobby-field">
          <span>Invite token</span>
          <input
            className="invite-token-input"
            value={inviteValue}
            onChange={(event) => onInviteValueChange(event.target.value)}
            maxLength={INVITE_TOKEN_LENGTH}
            placeholder="Invite token"
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
    </form>
  </>
);
