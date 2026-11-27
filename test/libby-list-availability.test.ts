import { describe, expect, it } from "vitest";
import { HttpError } from "../src/errors.js";
import { listLibraryAvailability } from "../src/libby-list-availability.js";

const cards = [
  { cardId: "1", advantageKey: "first", library: { name: "First" } },
  { cardId: "2", advantageKey: "second" },
  { cardId: "3", advantageKey: "third" },
];

describe("list library availability", () => {
  it("returns each card's catalog result and separates missing titles from failures", async () => {
    const result = await listLibraryAvailability(
      "42",
      { sync: async () => ({ cards }) },
      {
        getLibraryMedia: async (key, id) => {
          if (key === "second") throw new HttpError("missing", 404, "", {});
          if (key === "third") throw new Error("network error");
          return { id, title: "Book", isAvailable: true, ownedCopies: 4, availableCopies: 1, holdsCount: 2 };
        },
      },
    );
    expect(result.map((row) => row.status)).toEqual(["ok", "not-offered", "error"]);
    expect(result[0]?.media?.availableCopies).toBe(1);
  });
  it("rejects invalid title IDs and propagates account failures", async () => {
    const client = {
      sync: async () => {
        throw new Error("not connected");
      },
    };
    const catalog = { getLibraryMedia: async () => ({ id: "1", title: "A" }) };
    await expect(listLibraryAvailability("", client, catalog)).rejects.toThrow("Invalid title ID");
    await expect(listLibraryAvailability("1", client, catalog)).rejects.toThrow("not connected");
  });
});
