import { describe, expect, it } from "vitest";
import { listAudiobookLoans, loanUrl, narratorsForItem } from "../src/libby-audiobooks.js";
import type { LibbyClient } from "../src/libby-client.js";

const fakeClient = (state: unknown, progress: Record<string, number | Error>) =>
  ({
    sync: async () => state,
    loanProgress: async ({ titleId }: { titleId: string }) => {
      const value = progress[titleId];
      if (value instanceof Error) throw value;
      return value;
    },
  }) as unknown as LibbyClient;

describe("loanUrl", () => {
  it("builds the open-loan address", () => {
    expect(loanUrl("1", "11")).toBe("https://libbyapp.com/open/loan/1/11");
    expect(loanUrl("a/b", "c")).toBe("https://libbyapp.com/open/loan/a%2Fb/c");
  });
});

describe("listAudiobookLoans", () => {
  const state = {
    cards: [{ cardId: "1" }],
    loans: [
      { id: "11", cardId: "1", title: "Dune", type: { id: "audiobook" } },
      { id: "12", cardId: "1", title: "Emma", type: { id: "ebook" } },
      { id: "13", cardId: "1", title: "Kim", type: { id: "audiobook" } },
      { id: "14", cardId: "9", title: "Ulysses", type: { id: "audiobook" } },
    ],
  };

  it("lists audiobooks with progress, status and address", async () => {
    const rows = await listAudiobookLoans(fakeClient(state, { "11": 42.5, "13": new Error("boom") }));
    expect(rows).toEqual([
      { titleId: "11", title: "Dune", progress: 42.5, status: "reading", url: "https://libbyapp.com/open/loan/1/11" },
      { titleId: "13", title: "Kim", status: "progress unavailable", url: "https://libbyapp.com/open/loan/1/13" },
      { titleId: "14", title: "Ulysses", status: "card missing" },
    ]);
  });

  it("reads zero as not started and 100 as finished", async () => {
    const rows = await listAudiobookLoans(fakeClient(state, { "11": 0, "13": 100 }));
    expect(rows.map((row) => row.status)).toEqual(["not started", "finished", "card missing"]);
  });

  it("throws when the account read fails instead of returning no books", async () => {
    const client = { sync: async () => Promise.reject(new Error("401")) } as unknown as LibbyClient;
    await expect(listAudiobookLoans(client)).rejects.toThrow("401");
  });

  it("uses explicit credits before catalog fallback and keeps loans when catalog fails", async () => {
    const calls: string[] = [];
    const rows = await listAudiobookLoans(
      fakeClient(
        {
          cards: [{ cardId: "1", advantageKey: "library-4" }],
          loans: [
            { id: "21", cardId: "1", title: "Catalog", type: { id: "audiobook" } },
            {
              id: "22",
              cardId: "1",
              title: "Explicit",
              type: { id: "audiobook" },
              creators: [{ name: "Ian Holm", role: "Narrator" }],
            },
          ],
        },
        { "21": 12, "22": 4 },
      ),
      {
        getLibraryMedia: async (library: string, titleId: string) => {
          calls.push(`${library}:${titleId}`);
          return { id: titleId, title: "Catalog", creators: [{ name: "Catalog Voice", role: "Narrator" }] };
        },
      } as never,
    );

    expect(rows).toEqual([
      {
        titleId: "21",
        title: "Catalog",
        narrators: ["Catalog Voice"],
        progress: 12,
        status: "reading",
        url: "https://libbyapp.com/open/loan/1/21",
      },
      {
        titleId: "22",
        title: "Explicit",
        narrators: ["Ian Holm"],
        progress: 4,
        status: "reading",
        url: "https://libbyapp.com/open/loan/1/22",
      },
    ]);
    expect(calls).toEqual(["library-4:21"]);

    const failed = await listAudiobookLoans(
      fakeClient(
        {
          cards: [{ cardId: "1", advantageKey: "library-5" }],
          loans: [{ id: "23", cardId: "1", title: "Still here", type: { id: "audiobook" } }],
        },
        { "23": 9 },
      ),
      {
        getLibraryMedia: () => {
          throw new Error("catalog down");
        },
      },
    );
    expect(failed[0]).toMatchObject({ titleId: "23", progress: 9, status: "reading" });
    expect(failed[0]).not.toHaveProperty("narrators");
  });

  it("retries empty catalog credits and reuses successful credits across refreshes", async () => {
    let calls = 0;
    const item = { id: "24", type: { id: "audiobook" } };
    const card = { advantageKey: "library-6" };
    const catalog = {
      getLibraryMedia: async () => ({
        id: item.id,
        title: "Audio",
        creators: ++calls === 1 ? [] : [{ name: "Catalog Voice", role: "Narrator" }],
      }),
    };
    expect(await narratorsForItem(item, card, catalog)).toEqual([]);
    expect(await narratorsForItem(item, card, catalog)).toEqual(["Catalog Voice"]);
    expect(await narratorsForItem(item, card, catalog)).toEqual(["Catalog Voice"]);
    expect(calls).toBe(2);
  });
});
