import { useCallback, useEffect, useState } from "react";
import { EXTERNAL_QUERY_COOLDOWN_MS } from "../../../src/query-cooldown.ts";

/**
 * Wait `ms` after `start()` before the action may run again. `remaining` counts whole seconds down to 0,
 * ticking once a second only while a cooldown is active.
 */
export function useCooldown(ms: number = EXTERNAL_QUERY_COOLDOWN_MS) {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const start = useCallback(() => {
    const at = Date.now();
    setNow(at);
    setUntil(at + ms);
  }, [ms]);

  useEffect(() => {
    // The deadline can pass before this runs (a slow render, a sleeping laptop); catch the clock up then.
    if (until <= Date.now()) {
      setNow(Date.now());
      return;
    }
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= until) clearInterval(timer);
    }, 1_000);
    return () => clearInterval(timer);
  }, [until]);

  const remaining = Math.max(0, Math.ceil((until - now) / 1_000));
  return { remaining, cooling: remaining > 0, start };
}
