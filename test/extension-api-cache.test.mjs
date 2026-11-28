import { beforeEach, describe, expect, it, vi } from "vitest";

const { sync, libbyClient } = vi.hoisted(() => {
  const sync = vi.fn();
  return { sync, libbyClient: vi.fn(async () => ({ sync })) };
});
vi.mock("../extension/src/libby-session.ts", () => ({ libbyClient, libbyProblem: () => "" }));
vi.mock("../extension/src/fable-get.ts", () => ({
  createFableGet: vi.fn(),
  createFablePost: vi.fn(),
  isFableSignedIn: async () => false,
}));
const storage = new Map();
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (key) => ({ [key]: storage.get(key) }),
      set: async (values) => {
        for (const [key, value] of Object.entries(values)) storage.set(key, value);
      },
    },
  },
  tabs: { create: vi.fn() },
});

const { extensionApi, forgetCachedReads } = await import("../extension/src/extension-api.ts");
const card = { cardId: "1", advantageKey: "lib" };

beforeEach(() => {
  forgetCachedReads();
  storage.clear();
  sync.mockReset();
  sync.mockResolvedValue({ cards: [card], loans: [], holds: [] });
});

describe("extension read cache", () => {
  it("serves repeated reads from the last result instead of asking Libby again", async () => {
    expect(await extensionApi.cards("")).toEqual([card]);
    expect(await extensionApi.cards("")).toEqual([card]);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("reaches Libby again after the kept reads are forgotten", async () => {
    await extensionApi.cards("");
    forgetCachedReads();
    sync.mockResolvedValue({ cards: [], loans: [], holds: [] });
    expect(await extensionApi.cards("")).toEqual([]);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("never keeps a failure", async () => {
    sync.mockRejectedValueOnce(new Error("Libby is down"));
    await expect(extensionApi.cards("")).rejects.toThrow("Libby is down");
    expect(await extensionApi.cards("")).toEqual([card]);
  });

  it("forgets kept reads after a settings save", async () => {
    await extensionApi.cards("");
    await extensionApi.saveSyncSettings({});
    await extensionApi.cards("");
    expect(sync).toHaveBeenCalledTimes(2);
  });
});
