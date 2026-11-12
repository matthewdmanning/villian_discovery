import type { LibbyCard, ThunderMedia } from "../src/types.js";

export function card(over: Partial<LibbyCard> = {}): LibbyCard {
  return {
    cardId: "100",
    cardName: "Main",
    advantageKey: "lib1",
    limits: { loan: 10, hold: 10 },
    counts: { loan: 0, hold: 0 },
    lendingPeriods: { book: { options: [[7, "days"], [14, "days"], [21, "days"]], preference: [14, "days"] } },
    ...over,
  };
}

export function media(over: Partial<ThunderMedia> = {}): ThunderMedia {
  return {
    id: "111",
    title: "Project Hail Mary",
    firstCreatorName: "Andy Weir",
    type: { id: "ebook" },
    formats: [{ id: "ebook-overdrive", identifiers: [{ type: "ISBN", value: "9780593135204" }] }],
    isAvailable: false,
    isOwned: true,
    ownedCopies: 5,
    availableCopies: 0,
    holdsCount: 20,
    estimatedWaitDays: 30,
    ...over,
  };
}

interface Route {
  method?: string;
  match: RegExp;
  respond: (url: URL, init: RequestInit) => { status?: number; body?: unknown; headers?: Record<string, string> };
}

/** Tiny fetch fake: first matching route wins; records every call. */
export function fakeFetch(routes: Route[]) {
  const calls: { method: string; url: URL; body: unknown; headers: Record<string, string> }[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? safeJson(init.body) : undefined;
    calls.push({ method, url, body, headers: (init.headers ?? {}) as Record<string, string> });
    const route = routes.find((r) => (!r.method || r.method === method) && r.match.test(url.href));
    if (!route) return new Response(JSON.stringify({ message: "no route" }), { status: 404 });
    const r = route.respond(url, init);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json", ...r.headers },
    });
  }) as typeof fetch;
  return { fetch: fn, calls };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
