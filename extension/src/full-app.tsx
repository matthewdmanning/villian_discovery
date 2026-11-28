import "@fontsource-variable/fredoka";
import "@fontsource-variable/nunito";
import "./panel.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../ui/src/App.tsx";
import { StoreProvider } from "../../ui/src/lib/store.tsx";
import { extensionApi, openInLibby } from "./extension-api.ts";
import { postToFable } from "./fable-review.ts";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <StoreProvider api={extensionApi}>
      <App openLoan={openInLibby} postReview={postToFable} />
    </StoreProvider>
  </StrictMode>,
);
