import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DEPLOYMENT_MODE } from "../../lib/config/env.js";
import { P2PJoinPage } from "../../p2p/pages/P2PJoinPage.js";
import { HomePage } from "../../pages/HomePage.js";
import { InvitePage } from "../../pages/InvitePage.js";
import { LobbyPage } from "../../pages/LobbyPage.js";
import { NotFoundPage } from "../../pages/NotFoundPage.js";
import { RoomPage } from "../../pages/RoomPage.js";

export const AppRouter = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/lobby" element={<LobbyPage />} />
      {DEPLOYMENT_MODE === "p2p" ? (
        <Route path="/p2p/join/:sessionId" element={<P2PJoinPage />} />
      ) : null}
      <Route path="/invite/:inviteToken" element={<InvitePage />} />
      <Route path="/room/:roomCode" element={<RoomPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  </BrowserRouter>
);
