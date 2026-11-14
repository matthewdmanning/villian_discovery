import raw from "../../../docs/wireframes/libby-ui.wireframe.json";

/** Typed view of docs/wireframes/libby-ui.wireframe.json. The UI follows its options and screen list. */
export type ScreenId = "connect" | "cards" | "books" | "settings" | "search" | "results";

export interface SpecComponent {
  type: string;
  label: string;
  binds?: string;
  advanced?: boolean;
  hint?: string;
  options?: string[];
  values?: string[];
  columns?: string[];
}
export interface SpecRegion {
  id: string;
  advanced?: boolean;
  components: SpecComponent[];
}
export interface SpecScreen {
  id: ScreenId;
  title: string;
  cli: string;
  enabled: boolean;
  regions: SpecRegion[];
}
export interface SpecOptions {
  layout: "desktop" | "mobile";
  density: "comfortable" | "compact";
  navigation: "sidebar" | "tabs" | "wizard";
  defaultScreen: ScreenId;
  showAdvanced: boolean;
}

const spec = raw as unknown as { options: SpecOptions; screens: SpecScreen[] };

export const options: SpecOptions = spec.options;
export const screens: SpecScreen[] = spec.screens.filter((s) => s.enabled);

export function screen(id: ScreenId): SpecScreen | undefined {
  return screens.find((s) => s.id === id);
}

/** Label of the component bound to `binds` on a screen, so UI copy stays in the spec. */
export function labelFor(id: ScreenId, binds: string, fallback: string): string {
  const c = screen(id)
    ?.regions.flatMap((r) => r.components)
    .find((x) => x.binds === binds);
  return c?.label ?? fallback;
}
