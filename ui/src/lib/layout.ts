import { useSyncExternalStore } from "react";
import { options } from "./spec.ts";

/** Phone chrome (bottom dock) shows below Tailwind's `lg`, or always when the spec forces the mobile layout. */
const DESKTOP = "(min-width: 64rem)";

function subscribe(onChange: () => void) {
  const mq = matchMedia(DESKTOP);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True when the app shows its phone layout. Matches App's `lg:hidden` dock. */
export function useIsPhone(): boolean {
  const desktop = useSyncExternalStore(
    subscribe,
    () => matchMedia(DESKTOP).matches,
    () => true,
  );
  return options.layout === "mobile" || !desktop;
}
