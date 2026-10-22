import { useLayoutEffect, useRef, useState } from "react";
import { BrowserRouter, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useGameClient } from "../../features/connection/useGameClient.js";
import { DEPLOYMENT_MODE } from "../../lib/config/env.js";
import { P2PJoinPage } from "../../p2p/pages/P2PJoinPage.js";
import { InvitePage } from "../../pages/InvitePage.js";
import { LobbyPage } from "../../pages/LobbyPage.js";
import { NotFoundPage } from "../../pages/NotFoundPage.js";
import { RoomPage } from "../../pages/RoomPage.js";
import { SoloPage } from "../../pages/SoloPage.js";
import { GameClientProvider } from "../providers/GameClientProvider.js";

const RoomExitCancellation = () => {
  const { pathname } = useLocation();
  const previousPathname = useRef(pathname);
  const navigate = useNavigate();
  const { session, match, cancelRoom, roomCancelPending, roomCancelAttempted } = useGameClient();

  useLayoutEffect(() => {
    const leftWaitingRoom =
      previousPathname.current.startsWith("/room/") && (pathname === "/" || pathname === "/lobby");
    previousPathname.current = pathname;
    if (DEPLOYMENT_MODE === "server" && leftWaitingRoom && session && !match) cancelRoom();
  }, [cancelRoom, match, pathname, session]);

  useLayoutEffect(() => {
    if (
      DEPLOYMENT_MODE === "server" &&
      (pathname === "/" || pathname === "/lobby") &&
      roomCancelAttempted &&
      !roomCancelPending &&
      session
    ) {
      navigate(`/room/${session.roomCode}`, { replace: true });
    }
  }, [navigate, pathname, roomCancelAttempted, roomCancelPending, session]);

  return null;
};

const FriendRoutes = () => {
  const { pathname } = useLocation();
  const friendActivated = useRef(pathname !== "/");
  if (pathname !== "/") friendActivated.current = true;
  const [friendRequested, setFriendRequested] = useState(false);
  return (
    <GameClientProvider enabled={friendRequested || friendActivated.current}>
      <RoomExitCancellation />
      <Outlet context={() => setFriendRequested(true)} />
    </GameClientProvider>
  );
};

export const AppRouter = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/solo" element={<SoloPage />} />
      <Route element={<FriendRoutes />}>
        <Route path="/" element={<LobbyPage />} />
        <Route path="/lobby" element={<LobbyPage />} />
        {DEPLOYMENT_MODE === "p2p" ? (
          <Route path="/p2p/join/:sessionId" element={<P2PJoinPage />} />
        ) : null}
        <Route path="/invite/:inviteToken" element={<InvitePage />} />
        <Route path="/room/:roomCode" element={<RoomPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  </BrowserRouter>
);
