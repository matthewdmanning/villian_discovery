import "@fontsource-variable/fredoka";
import "@fontsource-variable/nunito";
import "./panel.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../ui/src/App.tsx";
import { StoreProvider } from "../../ui/src/lib/store.tsx";
import { extensionApi } from "./extension-api.ts";
import { Tags } from "./Tags.tsx";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <StoreProvider api={extensionApi}>
      <App tagsView={Tags} />
    </StoreProvider>
  </StrictMode>,
);
