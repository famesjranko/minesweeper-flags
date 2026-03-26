import ReactDOM from "react-dom/client";
import { GameClientProvider } from "./app/providers/GameClientProvider.js";
import { AppRouter } from "./app/router/AppRouter.js";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <GameClientProvider>
    <AppRouter />
  </GameClientProvider>
);

