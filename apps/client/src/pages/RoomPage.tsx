import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useGameClient } from "../features/connection/useGameClient.js";
import { MatchMessage } from "../features/match/MatchMessage.js";
import { MatchView } from "../features/match/MatchView.js";
import { HostDirectMatchPanel } from "../features/room/HostDirectMatchPanel.js";
import { RoomRestoringPanel } from "../features/room/RoomRestoringPanel.js";
import { RoomUnavailablePanel } from "../features/room/RoomUnavailablePanel.js";
import { type InviteNotice, RoomWaitingPanel } from "../features/room/RoomWaitingPanel.js";
import { useRoomRecovery } from "../features/room/useRoomRecovery.js";
import { copyText } from "../lib/browser/copy-text.js";
import { canShareLinks, shareLink } from "../lib/browser/share-link.js";
import { DEPLOYMENT_MODE } from "../lib/config/env.js";

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Route recovery and waiting state share one page.
export const RoomPage = () => {
  const { roomCode = "" } = useParams();
  const [inviteNotice, setInviteNotice] = useState<InviteNotice | null>(null);
  const navigate = useNavigate();
  const gameClient = useGameClient();
  const {
    connectionStatus,
    error,
    session,
    match,
    hasStoredSession,
    reconnect,
    p2pSetup,
    cancelRoom,
    roomCancelPending,
    roomCancelAttempted
  } = gameClient;
  // Set when the host asks to leave; the exit completes once the seat is gone, whether the
  // server confirmed a cancellation, a timed-out cancellation proved the room gone, or the
  // host left while offline. It is dropped only when the room is known to have survived.
  const exitDestination = useRef<string | null>(null);

  useEffect(() => {
    if (!exitDestination.current || roomCancelPending) return;
    if (session) {
      if (!roomCancelAttempted) exitDestination.current = null;
      return;
    }
    navigate(exitDestination.current, { replace: true });
  }, [navigate, roomCancelAttempted, roomCancelPending, session]);
  const isP2PDeployment = DEPLOYMENT_MODE === "p2p";
  const hostSetup = p2pSetup?.host ?? null;

  const recovery = useRoomRecovery({
    roomCode,
    session,
    hasMatch: !!match,
    error,
    hasStoredSession,
    reconnect
  });

  if (!roomCode) {
    return null;
  }

  const copyInviteValue = async (value: string, successMessage: string) => {
    const copied = await copyText(value);
    setInviteNotice(
      copied
        ? { message: successMessage, failed: false }
        : { message: "Copy failed. Copy it manually from the screen.", failed: true }
    );
  };

  const shareInvite = canShareLinks()
    ? async (value: string) => {
        const result = await shareLink("Minesweeper Flags", value);
        if (result === "failed") {
          setInviteNotice({ message: "Sharing failed. Copy the link instead.", failed: true });
        }
      }
    : undefined;

  if (recovery.isRestoring) return <RoomRestoringPanel />;

  if (!session || session.roomCode !== roomCode) {
    return (
      <RoomUnavailablePanel
        roomCode={roomCode}
        error={error}
        isP2PDeployment={isP2PDeployment}
        canReconnect={hasStoredSession(roomCode)}
        waitingForHost={
          isP2PDeployment && !error && hostSetup?.stage === "idle" && hasStoredSession(roomCode)
        }
        onReconnect={recovery.reconnect}
      />
    );
  }

  if (match) {
    return (
      <main className="page-shell arcade-page-shell arcade-match-page">
        <MatchMessage
          error={error}
          connectionStatus={connectionStatus}
          onExpire={gameClient.clearError}
        />

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
          onBackToLobby={() => navigate("/lobby")}
        />
      </main>
    );
  }

  if (isP2PDeployment) {
    return (
      <HostDirectMatchPanel
        roomCode={roomCode}
        hostSetup={hostSetup}
        inviteNotice={inviteNotice}
        error={error}
        onCopy={copyInviteValue}
        onShare={shareInvite}
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
      onShare={shareInvite}
      onCancelRoom={() => {
        if (roomCancelPending) return;
        exitDestination.current = "/lobby";
        cancelRoom();
      }}
      onHome={() => {
        if (roomCancelPending) return;
        exitDestination.current = "/";
        cancelRoom();
      }}
      cancelPending={roomCancelPending}
    />
  );
};
