import { describe, expect, it } from "vitest";
import { createFableGet, isFableSignedIn } from "../extension/src/fable-get.js";
import { HttpError } from "../src/errors.js";
import { fetchAllPages } from "../src/pagination.js";

const respond = (status: number, body: unknown = {}) => (async () => Response.json(body, { status })) as typeof fetch;

describe("createFableGet", () => {
  it("sends the query and the session cookies to fable.co", async () => {
    let seen: { url: string; credentials?: string } | undefined;
    const get = createFableGet((async (url: URL, init?: RequestInit) => {
      seen = { url: String(url), ...(init?.credentials ? { credentials: init.credentials } : {}) };
      return Response.json({ results: [], next: null });
    }) as unknown as typeof fetch);
    await get("/api/me/book-lists", { limit: 50, offset: 0 });
    expect(seen).toEqual({ url: "https://fable.co/api/me/book-lists?limit=50&offset=0", credentials: "include" });
  });

  it("throws an HttpError for a non-2xx status", async () => {
    await expect(createFableGet(respond(500))("/api/x", {})).rejects.toBeInstanceOf(HttpError);
  });
});

describe("isFableSignedIn", () => {
  it("reads 401 and 403 as signed out", async () => {
    expect(await isFableSignedIn(createFableGet(respond(401)))).toBe(false);
    expect(await isFableSignedIn(createFableGet(respond(403)))).toBe(false);
  });

  it("reads a book-lists page as signed in", async () => {
    expect(await isFableSignedIn(createFableGet(respond(200, { results: [], next: null })))).toBe(true);
  });

  it("rethrows other failures instead of reporting signed out", async () => {
    await expect(isFableSignedIn(createFableGet(respond(500)))).rejects.toBeInstanceOf(HttpError);
  });
});

describe("fetchAllPages", () => {
  it("follows next links by query and stops on an empty page", async () => {
    const pages: Record<string, { next: string | null; results: number[] }> = {
      "0": { next: "https://api.fable.co/x?limit=2&offset=2", results: [1, 2] },
      "2": { next: "https://api.fable.co/x?limit=2&offset=4", results: [] },
    };
    const all = await fetchAllPages({ limit: 2, offset: 0 }, async (query) => pages[String(query.offset)]!);
    expect(all).toEqual([1, 2]);
  });
});
