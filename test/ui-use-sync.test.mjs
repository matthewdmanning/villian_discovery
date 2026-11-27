// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYNC_FALLBACKS } from "../src/sync-config.ts";
import { act, createElement } from "../ui/node_modules/react/index.js";
import { createRoot } from "../ui/node_modules/react-dom/client.js";
import { demoApi } from "../ui/src/lib/api.ts";
import { StoreProvider } from "../ui/src/lib/store.tsx";
import { useSync } from "../ui/src/lib/use-sync.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Real plans always carry a boolean `removal`.
const op = (id, extra = {}) => ({ id, title: id, removal: false, ...extra });
const conflict = { before: { value: 10 } };
const planOf = (operations) => ({ id: "plan-1", rows: [], operations, options: {} });

let root;
let container;
let hook;
function Probe() {
  hook = useSync();
  return null;
}
const flush = () => act(async () => {});

async function mount(api = {}) {
  const fake = {
    ...demoApi,
    getSyncSettings: vi.fn(async () => ({ ...SYNC_FALLBACKS })),
    previewSync: vi.fn(async () => planOf([])),
    applySync: vi.fn(async () => ({ outcomes: [] })),
    saveSyncSettings: vi.fn(async (input) => ({ ...SYNC_FALLBACKS, ...input })),
    ...api,
  };
  await act(async () => {
    root.render(createElement(StoreProvider, { api: fake }, createElement(Probe)));
  });
  await flush();
  return fake;
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("useSync", () => {
  it("previews once when settings load and keeps that result", async () => {
    const api = await mount();
    expect(api.previewSync).toHaveBeenCalledTimes(1);
    expect(hook.syncResult.plan.id).toBe("plan-1");
    await flush();
    expect(api.previewSync).toHaveBeenCalledTimes(1);
  });

  it("selects reviewable changes but not blocked or removal ones, and counts every unblocked one", async () => {
    await mount({
      previewSync: vi.fn(async () =>
        planOf([op("a"), op("b", { blocked: "Needs review" }), op("c", { removal: true })]),
      ),
    });
    expect(hook.review).toEqual({ selected: ["a"], removals: [] });
    expect(hook.resultSummary.summary).toBe("2 changes found. Review before applying.");
  });

  it("does not preview automatically when saved settings fail to load, and says so", async () => {
    const api = await mount({ getSyncSettings: vi.fn(async () => Promise.reject(new Error("disk"))) });
    expect(hook.settings).toEqual(SYNC_FALLBACKS);
    expect(hook.error).toContain("Saved settings could not be loaded");
    expect(api.previewSync).not.toHaveBeenCalled();
    await act(async () => hook.sync());
    expect(api.previewSync).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous result and reports the error when a later preview fails", async () => {
    const previewSync = vi
      .fn()
      .mockResolvedValueOnce(planOf([op("a")]))
      .mockRejectedValueOnce(new Error("Fable is down"));
    await mount({ previewSync });
    await act(async () => hook.sync());
    expect(hook.error).toBe("Fable is down");
    expect(hook.syncResult.plan.operations).toHaveLength(1);
    expect(hook.busy).toBe(false);
  });

  it("ignores a second request while one is running", async () => {
    let finish;
    const previewSync = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    await mount({ previewSync });
    await act(async () => hook.sync());
    expect(previewSync).toHaveBeenCalledTimes(1);
    await act(async () => finish(planOf([])));
    expect(hook.busy).toBe(false);
  });

  it("applies the plan with the reviewed approvals and records the report", async () => {
    const applySync = vi.fn(async () => ({ outcomes: [{ operationId: "a", status: "success" }] }));
    await mount({ previewSync: vi.fn(async () => planOf([op("a", conflict)])), applySync });
    await act(async () => hook.apply());
    expect(applySync).toHaveBeenCalledWith("plan-1", { selected: ["a"], removals: [] });
    expect(hook.syncResult.report.outcomes).toHaveLength(1);
    expect(hook.remaining).toEqual([]);
    expect(hook.outcomeOf("a")).toBe("success");
    expect(hook.resultSummary).toEqual({ status: "Success", summary: "Applied 1 change." });
  });

  it("keeps the preview and still shows the changes when apply fails", async () => {
    await mount({
      previewSync: vi.fn(async () => planOf([op("a", conflict)])),
      applySync: vi.fn(async () => Promise.reject(new Error("Expired"))),
    });
    await act(async () => hook.apply());
    expect(hook.error).toBe("Expired");
    expect(hook.syncResult.report).toBeUndefined();
    expect(hook.remaining).toHaveLength(1);
  });

  it("keeps a failed change pending so it can be tried again", async () => {
    await mount({
      previewSync: vi.fn(async () => planOf([op("a", conflict), op("b", conflict)])),
      applySync: vi.fn(async () => ({
        outcomes: [
          { operationId: "a", status: "success" },
          { operationId: "b", status: "failed" },
        ],
      })),
    });
    await act(async () => hook.apply());
    expect(hook.remaining.map((operation) => operation.id)).toEqual(["b"]);
    expect(hook.resultSummary.status).toBe("Fail");
  });

  it("requires approval for selected removals and blocked changes", async () => {
    await mount({ previewSync: vi.fn(async () => planOf([op("r", { removal: true, ...conflict })])) });
    expect(hook.missingApproval).toBe(false);
    await act(async () => hook.selectOperations(["r"], true));
    expect(hook.missingApproval).toBe(true);
    await act(async () => hook.toggleReview("removals", "r", true));
    expect(hook.missingApproval).toBe(false);
    await act(async () => hook.toggleReview("removals", "r", false));
    expect(hook.missingApproval).toBe(true);
    await act(async () => hook.selectOperations(["r"], false));
    expect(hook.missingApproval).toBe(false);
  });

  it("selects and clears several changes without duplicates", async () => {
    await mount({ previewSync: vi.fn(async () => planOf([op("a", conflict), op("b", conflict)])) });
    await act(async () => hook.selectOperations(["a", "b"], true));
    expect(hook.review.selected.sort()).toEqual(["a", "b"]);
    await act(async () => hook.selectOperations(["a"], false));
    expect(hook.review.selected).toEqual(["b"]);
  });

  it("lists removals first and hides changes that overwrite nothing unless they create a book", async () => {
    await mount({
      previewSync: vi.fn(async () =>
        planOf([
          op("plain"),
          op("conflict", conflict),
          op("created", { create: true }),
          op("gone", { removal: true, ...conflict }),
        ]),
      ),
    });
    expect(hook.visibleOperations.map((operation) => operation.id)).toEqual(["gone", "conflict", "created"]);
  });

  it("shows every change when settings ask for non-conflicting ones", async () => {
    await mount({
      getSyncSettings: vi.fn(async () => ({ ...SYNC_FALLBACKS, showNonConflicting: "yes" })),
      previewSync: vi.fn(async () => planOf([op("plain"), op("conflict", conflict)])),
    });
    expect(hook.visibleOperations).toHaveLength(2);
  });

  it("previews again after settings are saved, and reports a failed save without losing the result", async () => {
    const saveSyncSettings = vi
      .fn()
      .mockResolvedValueOnce({ ...SYNC_FALLBACKS })
      .mockRejectedValueOnce(new Error("Read-only"));
    const api = await mount({ saveSyncSettings });
    await act(async () => hook.saveSettings({}));
    await flush();
    expect(api.previewSync).toHaveBeenCalledTimes(2);
    await act(async () => hook.saveSettings({}));
    expect(hook.error).toBe("Settings were not saved: Error: Read-only");
    expect(hook.syncResult).toBeDefined();
    expect(api.previewSync).toHaveBeenCalledTimes(2);
  });

  it("does not apply while another request is running", async () => {
    let finish;
    const previewSync = vi
      .fn()
      .mockResolvedValueOnce(planOf([op("a", conflict)]))
      .mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const api = await mount({ previewSync });
    await act(async () => {
      void hook.sync();
    });
    expect(hook.busy).toBe(true);
    await act(async () => hook.apply());
    expect(api.applySync).not.toHaveBeenCalled();
    await act(async () => finish(planOf([])));
  });

  it("does nothing before settings have loaded", async () => {
    let release;
    const getSyncSettings = vi.fn(() => new Promise((resolve) => (release = resolve)));
    const api = await mount({ getSyncSettings });
    await act(async () => {
      await hook.sync();
      await hook.apply();
    });
    expect(api.previewSync).not.toHaveBeenCalled();
    expect(api.applySync).not.toHaveBeenCalled();
    await act(async () => release({ ...SYNC_FALLBACKS }));
    expect(api.previewSync).toHaveBeenCalledTimes(1);
  });
});
