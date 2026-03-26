import { useEffect, useState } from "react";
import { LobbyPreviewPanel } from "./LobbyPreviewPanel.js";

interface RoomLobbyProps {
  connectionStatus: string;
  error: string | null;
  initialRoomCode?: string;
  onCreateRoom: (displayName: string) => void;
  onJoinRoom: (displayName: string, roomCode: string) => void;
}

export const RoomLobby = ({
  connectionStatus,
  error,
  initialRoomCode = "",
  onCreateRoom,
  onJoinRoom
}: RoomLobbyProps) => {
  const [displayName, setDisplayName] = useState("Captain Sweeper");
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const trimmedDisplayName = displayName.trim();
  const normalizedRoomCode = roomCode.trim().toUpperCase();
  const canCreateRoom = trimmedDisplayName.length > 0;
  const canJoinRoom = trimmedDisplayName.length > 0 && normalizedRoomCode.length >= 4;

  const handleCreateRoom = () => {
    if (!canCreateRoom) {
      return;
    }

    onCreateRoom(trimmedDisplayName);
  };

  const handleJoinRoom = () => {
    if (!canJoinRoom) {
      return;
    }

    onJoinRoom(trimmedDisplayName, normalizedRoomCode);
  };

  useEffect(() => {
    if (initialRoomCode) {
      setRoomCode(initialRoomCode);
    }
  }, [initialRoomCode]);

  return (
    <section className="panel hero-panel lobby-panel">
      <div className="hero-copy">
        <p className="eyebrow">MSN-style competitive minesweeper</p>
        <h1>Minesweeper Flags</h1>
        <p>
          Pick hidden squares on a shared 16x16 field. Mines are claimed for points,
          safe squares reveal clues, and the first player to 26 flags wins.
        </p>
      </div>

      <div className="lobby-stage">
        <LobbyPreviewPanel
          title="Classic duel board"
          badge="2 players"
          featurePills={[
            "Shared 16x16 field",
            "First to 26 mines",
            "One comeback bomb"
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
            <form
              className="lobby-action-card is-create"
              onSubmit={(event) => {
                event.preventDefault();
                handleCreateRoom();
              }}
            >
              <div className="lobby-card-heading">
                <h2>Create a Match</h2>
                <span>Host a room and share the code.</span>
              </div>

              <button
                className="lobby-action-button lobby-create-button"
                disabled={!canCreateRoom}
              >
                Create Room
              </button>
            </form>

            <form
              className="lobby-action-card is-join"
              onSubmit={(event) => {
                event.preventDefault();
                handleJoinRoom();
              }}
            >
              <div className="lobby-card-heading">
                <h2>Join by Invite</h2>
                <span>Enter a room code from another player.</span>
              </div>

              <label className="field lobby-field">
                <span>Invite code</span>
                <input
                  value={normalizedRoomCode}
                  onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                  maxLength={8}
                  placeholder="ABCDE"
                  spellCheck={false}
                />
              </label>

              <button
                className={[
                  "lobby-action-button",
                  "lobby-join-button",
                  canJoinRoom ? "is-ready" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={!canJoinRoom}
              >
                Join Room
              </button>
            </form>
          </div>
        </section>
      </div>

      <div className="status-strip lobby-status-strip">
        <span className="lobby-status-note">No account needed. Open two tabs or invite a friend.</span>
        {!canJoinRoom ? (
          <span className="lobby-status-note">Enter a room code to unlock Join Room.</span>
        ) : (
          <span className="lobby-status-note">Invite code looks good. Press Join Room.</span>
        )}
        {error ? <span className="error-text">{error}</span> : null}
      </div>
    </section>
  );
};
