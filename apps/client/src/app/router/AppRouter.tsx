import { BrowserRouter, Route, Routes } from "react-router-dom";
import { HomePage } from "../../pages/HomePage.js";
import { InvitePage } from "../../pages/InvitePage.js";
import { LobbyPage } from "../../pages/LobbyPage.js";
import { RoomPage } from "../../pages/RoomPage.js";

export const AppRouter = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/lobby" element={<LobbyPage />} />
      <Route path="/invite/:roomCode" element={<InvitePage />} />
      <Route path="/room/:roomCode" element={<RoomPage />} />
    </Routes>
  </BrowserRouter>
);
