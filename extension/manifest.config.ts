import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "Libby Shelf",
  version: pkg.version,
  action: { default_title: "Sync Libby and Fable" },
  side_panel: { default_path: "src/panel.html" },
  background: { service_worker: "src/background.ts", type: "module" },
  permissions: ["sidePanel", "scripting", "storage", "tabs", "declarativeNetRequest"],
  declarative_net_request: { rule_resources: [{ id: "libby-origin", enabled: true, path: "libby-origin-rules.json" }] },
  host_permissions: [
    "https://libbyapp.com/*",
    "https://sentry.libbyapp.com/*",
    "https://vandal.libbyapp.com/*",
    "https://thunder.api.overdrive.com/*",

    "https://fable.co/*",
  ],
});
