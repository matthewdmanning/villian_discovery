import { describe, expect, it } from "vitest";
import { listAudiobookLoans, loanUrl } from "../src/libby-audiobooks.js";
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
});
