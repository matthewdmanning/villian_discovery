// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "../extension/node_modules/react/index.js";
import { createRoot } from "../extension/node_modules/react-dom/client.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { connections, forceRefreshCards, forgetCachedReads } = vi.hoisted(() => ({
  connections: vi.fn(),
  forceRefreshCards: vi.fn(),
  forgetCachedReads: vi.fn(),
}));
vi.mock("../extension/src/extension-api.ts", () => ({
  connections,
  extensionApi: {},
  forgetCachedReads,
  openInLibby: vi.fn(),
}));
vi.mock("../ui/src/lib/store.tsx", () => ({
  StoreProvider: ({ children }) => children,
  useStore: () => ({ forceRefreshCards }),
}));
vi.mock("../ui/src/lib/theme.ts", () => ({ useTheme: vi.fn() }));
vi.mock("../ui/src/screens/Sync.tsx", () => ({ SyncScreen: () => null }));

let root;
let container;
let Connections;

beforeEach(async () => {
  vi.useFakeTimers();
  connections.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  ({ Connections } = await import("../extension/src/panel.tsx"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

it("shows a failed probe without stale connected state, then recovers", async () => {
  connections
    .mockResolvedValueOnce({ libby: true, fable: false, libbyProblem: "" })
    .mockRejectedValueOnce(new Error("probe failed"))
    .mockResolvedValueOnce({ libby: true, fable: false, libbyProblem: "" });
  await act(async () => root.render(createElement(Connections)));
  await act(async () => {});
  expect(container.querySelector('[aria-label="Libby: Connected"]')).not.toBeNull();

  await act(async () => {
    vi.advanceTimersByTime(3_000);
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Could not check connection");
  expect(container.querySelector('[aria-label="Libby: Could not check connection"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Libby: Connected"]')).toBeNull();

  await act(async () => {
    vi.advanceTimersByTime(3_000);
    await Promise.resolve();
  });
  expect(container.querySelector('[aria-label="Libby: Connected"]')).not.toBeNull();
  expect(container.textContent).not.toContain("probe failed");
});

it("forgets kept reads before reloading cards when the Libby connection changes", async () => {
  forgetCachedReads.mockClear();
  forceRefreshCards.mockClear();
  connections
    .mockResolvedValueOnce({ libby: false, fable: false, libbyProblem: "" })
    .mockResolvedValueOnce({ libby: true, fable: false, libbyProblem: "" });
  await act(async () => root.render(createElement(Connections)));
  await act(async () => {});
  expect(forgetCachedReads).toHaveBeenCalledTimes(1);
  await act(async () => {
    vi.advanceTimersByTime(3_000);
    await Promise.resolve();
  });
  expect(forgetCachedReads).toHaveBeenCalledTimes(2);
  expect(forceRefreshCards).toHaveBeenCalledTimes(2);
  for (const index of [0, 1])
    expect(forgetCachedReads.mock.invocationCallOrder[index]).toBeLessThan(
      forceRefreshCards.mock.invocationCallOrder[index],
    );
});
