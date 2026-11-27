// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "../ui/node_modules/react/index.js";
import { createRoot } from "../ui/node_modules/react-dom/client.js";
import { moveItem, useReorder } from "../ui/src/lib/use-reorder.ts";
import { errorMessage, useResource } from "../ui/src/lib/use-resource.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let hook;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("moveItem", () => {
  it("moves an entry and returns a copy", () => {
    const items = ["a", "b", "c"];
    expect(moveItem(items, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(items, 2, 0)).toEqual(["c", "a", "b"]);
    expect(items).toEqual(["a", "b", "c"]);
  });
  it("rejects no-op and out-of-range moves", () => {
    expect(moveItem(["a", "b"], 1, 1)).toBeUndefined();
    expect(moveItem(["a", "b"], -1, 0)).toBeUndefined();
    expect(moveItem(["a", "b"], 0, 2)).toBeUndefined();
  });
});

describe("useReorder", () => {
  function Probe({ items, onChange }) {
    hook = useReorder(items, onChange);
    return null;
  }
  const event = () => ({ preventDefault: vi.fn(), dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
  async function mount(items, onChange) {
    await act(async () => root.render(createElement(Probe, { items, onChange })));
  }

  it("moves a key to a new position", async () => {
    const onChange = vi.fn();
    await mount(["a", "b", "c"], onChange);
    hook.moveTo("c", 0);
    expect(onChange).toHaveBeenCalledWith(["c", "a", "b"]);
    hook.moveTo("a", 0);
    hook.moveTo("missing", 0);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("drops a dragged key onto another key", async () => {
    const onChange = vi.fn();
    await mount(["a", "b", "c"], onChange);
    const start = event();
    await act(async () => hook.dragProps("a").onDragStart(start));
    expect(start.dataTransfer.setData).toHaveBeenCalledWith("text/plain", "a");
    expect(hook.dragging).toBe("a");
    await act(async () => hook.dragProps("c").onDrop(event()));
    expect(onChange).toHaveBeenCalledWith(["b", "c", "a"]);
    expect(hook.dragging).toBeUndefined();
  });

  it("keeps keys outside the list from dragging or receiving drops", async () => {
    const onChange = vi.fn();
    await mount(["a", "b"], onChange);
    const outside = hook.dragProps("x");
    expect(outside.draggable).toBe(false);
    const start = event();
    outside.onDragStart(start);
    expect(start.preventDefault).toHaveBeenCalled();
    const over = event();
    outside.onDragOver(over);
    expect(over.preventDefault).not.toHaveBeenCalled();
    await act(async () => hook.dragProps("a").onDragStart(event()));
    await act(async () => hook.dragProps("x").onDrop(event()));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("useResource", () => {
  function Probe({ load, options }) {
    hook = useResource(load, options);
    return null;
  }
  async function mount(load, options) {
    await act(async () => root.render(createElement(Probe, { load, options })));
  }

  it("reports loading, then data", async () => {
    const pending = deferred();
    await mount(() => pending.promise);
    expect(hook).toMatchObject({ loading: true, data: undefined, error: undefined });
    await act(async () => pending.resolve(1));
    expect(hook).toMatchObject({ loading: false, data: 1, error: undefined });
  });

  it("reports a failure message and clears data by default", async () => {
    let call = 0;
    const load = vi.fn(async () => {
      call += 1;
      if (call > 1) throw new Error("Down");
      return "ok";
    });
    await mount(load);
    expect(hook.data).toBe("ok");
    await act(async () => hook.reload());
    expect(hook).toMatchObject({ loading: false, data: undefined, error: "Down", revision: 1 });
  });

  it("keeps stale data through reloads and failures when asked", async () => {
    const next = deferred();
    const load = vi.fn().mockResolvedValueOnce("first").mockReturnValueOnce(next.promise);
    await mount(load, { keepStale: true });
    await act(async () => hook.reload());
    expect(hook).toMatchObject({ loading: true, data: "first" });
    await act(async () => next.reject("Nope"));
    expect(hook).toMatchObject({ loading: false, data: "first", error: "Nope" });
  });

  it("ignores a superseded response", async () => {
    const slow = deferred();
    const fast = deferred();
    const load = vi.fn().mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    await mount(load);
    await act(async () => hook.reload());
    await act(async () => fast.resolve("new"));
    await act(async () => slow.resolve("old"));
    expect(hook).toMatchObject({ loading: false, data: "new" });
  });

  it("refetches when the loader changes", async () => {
    await mount(async () => "a");
    await mount(async () => "b");
    expect(hook.data).toBe("b");
  });

  it("never reports an empty error message", () => {
    expect(errorMessage(new Error(""))).toBe("Unknown error");
    expect(errorMessage("plain")).toBe("plain");
  });
});
