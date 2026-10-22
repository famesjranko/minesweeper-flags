import ReactDOM from "react-dom/client";
import { AppRouter } from "./app/router/AppRouter.js";
import "./styles.css";

export const App = () => <AppRouter />;

const rootElement = document.getElementById("root");

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<App />);
}
