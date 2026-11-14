import "@fontsource-variable/fredoka";
import "@fontsource-variable/nunito";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { StoreProvider } from "./lib/store.tsx";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
