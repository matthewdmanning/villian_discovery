import "@fontsource-variable/fredoka";
import "@fontsource-variable/nunito";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { demoApi } from "./lib/api.ts";
import { liveApi } from "./lib/live-api.ts";
import { StoreProvider } from "./lib/store.tsx";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <StoreProvider api={import.meta.env.MODE === "live" ? liveApi : demoApi}>
      <App />
    </StoreProvider>
  </StrictMode>,
);
