import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useGameClient } from "../features/connection/useGameClient.js";
import { MatchView } from "../features/match/MatchView.js";
import { HostDirectMatchPanel } from "../features/room/HostDirectMatchPanel.js";
import { RoomUnavailablePanel } from "../features/room/RoomUnavailablePanel.js";
import { RoomWaitingPanel } from "../features/room/RoomWaitingPanel.js";
import { DEPLOYMENT_MODE } from "../lib/config/env.js";

export const RoomPage = () => {
  const { roomCode = "" } = useParams();
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const gameClient = useGameClient();
  const { connectionStatus, error, session, match, hasStoredSession, reconnect, p2pSetup } =
    gameClient;
  const isP2PDeployment = DEPLOYMENT_MODE === "p2p";
  const hostSetup = p2pSetup?.host ?? null;

  useEffect(() => {
    if (!roomCode) {
      return;
    }

    if ((!session || session.roomCode !== roomCode) && hasStoredSession(roomCode)) {
      reconnect(roomCode);
    }
  }, [hasStoredSession, reconnect, roomCode, session]);

  if (!roomCode) {
    return null;
  }

  const copyInviteValue = async (value: string, successMessage: string) => {
    try {
      await window.navigator.clipboard.writeText(value);
      setInviteNotice(successMessage);
    } catch {
      setInviteNotice("Copy failed. Copy it manually from the screen.");
    }
  };

  if (!session || session.roomCode !== roomCode) {
    return (
      <RoomUnavailablePanel
        roomCode={roomCode}
        error={error}
        isP2PDeployment={isP2PDeployment}
        canReconnect={hasStoredSession(roomCode)}
        onReconnect={() => reconnect(roomCode)}
      />
    );
  }

  if (match) {
    return (
      <main className="page-shell room-page-shell">
        {error ? (
          <section className="panel error-banner">
            <p>{error}</p>
          </section>
        ) : null}

        <MatchView
          roomCode={roomCode}
          currentPlayerId={session.playerId}
          match={match}
          bombArmed={gameClient.bombArmed}
          connectionStatus={connectionStatus}
          chatMessages={gameClient.chatMessages}
          chatError={gameClient.chatError}
          chatDraft={gameClient.chatDraft}
          chatPending={gameClient.chatPending}
          onToggleBomb={gameClient.toggleBombMode}
          onCellSelect={gameClient.submitCellAction}
          onChatDraftChange={gameClient.setChatDraft}
          onSendChatMessage={gameClient.sendChatMessage}
          onResign={gameClient.resignMatch}
          onRequestRematch={gameClient.requestRematch}
          onCancelRematch={gameClient.cancelRematch}
        />
      </main>
    );
  }

  if (isP2PDeployment) {
    return (
      <HostDirectMatchPanel
        roomCode={roomCode}
        connectionStatus={connectionStatus}
        hostSetup={hostSetup}
        inviteNotice={inviteNotice}
        error={error}
        onCopy={copyInviteValue}
      />
    );
  }

  return (
    <RoomWaitingPanel
      roomCode={roomCode}
      connectionStatus={connectionStatus}
      session={session}
      inviteNotice={inviteNotice}
      error={error}
      onCopy={copyInviteValue}
    />
  );
};
