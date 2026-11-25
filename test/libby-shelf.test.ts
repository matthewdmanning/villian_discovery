import { describe, expect, it } from "vitest";
import { listShelf } from "../src/libby-shelf.js";

describe("listShelf", () => {
  it("exposes current loans and holds and does not invent returned titles", async () => {
    const shelf = await listShelf({
      sync: async () => ({
        cards: [{ cardId: "card-1", cardName: "Main", advantageKey: "library" }],
        loans: [{ id: "loan-1", cardId: "card-1", title: "Loan", type: { id: "audiobook" } }],
        holds: [{ id: "hold-1", cardId: "card-1", title: "Hold", holdListPosition: 3 }],
      }),
    } as never);

    expect(shelf.checkedOut).toEqual({
      status: "available",
      items: [{ id: "loan-1", cardId: "card-1", title: "Loan", cardName: "Main", mediaType: "audiobook" }],
    });
    expect(shelf.holds).toEqual({
      status: "available",
      items: [{ id: "hold-1", cardId: "card-1", title: "Hold", cardName: "Main", holdListPosition: 3 }],
    });
    expect(shelf.returned.status).toBe("unavailable");
  });

  it("does not treat missing loan or hold arrays as empty shelves", async () => {
    const shelf = await listShelf({ sync: async () => ({}) } as never);
    const malformed = await listShelf({ sync: async () => ({ loans: {}, holds: "not-a-list" }) } as never);

    expect(shelf.checkedOut).toEqual({ status: "unavailable", reason: "Libby did not provide checked-out data." });
    expect(shelf.holds).toEqual({ status: "unavailable", reason: "Libby did not provide holds data." });
    expect(malformed.checkedOut.status).toBe("unavailable");
    expect(malformed.holds.status).toBe("unavailable");
  });
});
