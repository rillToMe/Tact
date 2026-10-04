import { applyInitialTheme } from "./lib/theme";
import { currentWindowLabel } from "./lib/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

applyInitialTheme();

const label = currentWindowLabel();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App window={label} />
  </StrictMode>,
);
