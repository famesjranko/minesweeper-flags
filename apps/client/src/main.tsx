import ReactDOM from "react-dom/client";
import { AppErrorBoundary } from "./app/AppErrorBoundary.js";
import { AppRouter } from "./app/router/AppRouter.js";
import "./styles.css";

export const App = () => (
  <AppErrorBoundary>
    <AppRouter />
  </AppErrorBoundary>
);

const rootElement = document.getElementById("root");

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<App />);
}
