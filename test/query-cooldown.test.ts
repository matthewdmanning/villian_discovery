import { describe, expect, it, vi } from "vitest";
import { createQueryCooldown, EXTERNAL_QUERY_COOLDOWN_MS, withCooldown } from "../src/query-cooldown.js";

function clock(start = 0) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

describe("createQueryCooldown", () => {
  it("shares one in-flight request between identical callers", async () => {
    const cooldown = createQueryCooldown(1_000);
    let finish: (value: string) => void = () => {};
    const load = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const first = cooldown.run("k", load);
    const second = cooldown.run("k", load);
    await Promise.resolve();
    finish("v");
    expect(await Promise.all([first, second])).toEqual(["v", "v"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reuses a success until the cooldown has passed since it finished", async () => {
    const time = clock();
    const cooldown = createQueryCooldown(1_000, time.now);
    const load = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new");
    expect(await cooldown.run("k", load)).toBe("old");
    time.advance(999);
    expect(await cooldown.run("k", load)).toBe("old");
    time.advance(1);
    expect(await cooldown.run("k", load)).toBe("new");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps separate results per key", async () => {
    const cooldown = createQueryCooldown(1_000);
    expect(await cooldown.run("a", async () => 1)).toBe(1);
    expect(await cooldown.run("b", async () => 2)).toBe(2);
    expect(cooldown.size).toBe(2);
  });

  it("never keeps a failure, so a retry reaches the service", async () => {
    const cooldown = createQueryCooldown(1_000);
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce("up");
    await expect(cooldown.run("k", load)).rejects.toThrow("down");
    expect(await cooldown.run("k", load)).toBe("up");
  });

  it("turns a synchronous throw into a rejection", async () => {
    const cooldown = createQueryCooldown(1_000);
    await expect(
      cooldown.run("k", () => {
        throw new Error("bad input");
      }),
    ).rejects.toThrow("bad input");
    expect(cooldown.size).toBe(0);
  });

  it("forgets everything on clear and prunes expired results", async () => {
    const time = clock();
    const cooldown = createQueryCooldown(1_000, time.now);
    await cooldown.run("a", async () => 1);
    cooldown.clear();
    expect(cooldown.size).toBe(0);
    await cooldown.run("a", async () => 1);
    time.advance(1_000);
    await cooldown.run("b", async () => 2);
    expect(cooldown.size).toBe(1);
  });

  it("does not let a cleared request's failure remove a newer one", async () => {
    const cooldown = createQueryCooldown(1_000);
    let fail: (error: Error) => void = () => {};
    const stale = cooldown.run("k", () => new Promise((_, reject) => (fail = reject)));
    await Promise.resolve();
    cooldown.clear();
    expect(await cooldown.run("k", async () => "fresh")).toBe("fresh");
    fail(new Error("late"));
    await expect(stale).rejects.toThrow("late");
    expect(await cooldown.run("k", async () => "other")).toBe("fresh");
  });

  it("defaults to ten seconds", () => {
    expect(EXTERNAL_QUERY_COOLDOWN_MS).toBe(10_000);
  });
});

describe("withCooldown", () => {
  const setup = () => {
    const calls: string[] = [];
    const routes = {
      "GET /read": async (input: unknown) => {
        calls.push(`read ${JSON.stringify(input)}`);
        return calls.length;
      },
      "POST /write": async (input: unknown) => {
        calls.push("write");
        if (input === "fail") throw new Error("write failed");
        return "ok";
      },
      "GET /status": async (_input: unknown) => {
        calls.push("status");
        return "up";
      },
    };
    const cooldown = createQueryCooldown(60_000);
    const wrapped = withCooldown(routes, { reads: ["GET /read"], writes: ["POST /write"] }, cooldown);
    return { calls, wrapped, cooldown };
  };

  it("shares reads per route and input", async () => {
    const { calls, wrapped } = setup();
    expect(await wrapped["GET /read"]({ q: 1 })).toBe(1);
    expect(await wrapped["GET /read"]({ q: 1 })).toBe(1);
    expect(await wrapped["GET /read"]({ q: 2 })).toBe(2);
    expect(await wrapped["GET /read"](undefined)).toBe(3);
    expect(await wrapped["GET /read"](null)).toBe(3);
    expect(calls).toEqual(['read {"q":1}', 'read {"q":2}', "read undefined"]);
  });

  it("forgets kept reads after a write, even a failed one", async () => {
    const { calls, wrapped } = setup();
    await wrapped["GET /read"]("x");
    await wrapped["POST /write"]("ok");
    await wrapped["GET /read"]("x");
    await expect(wrapped["POST /write"]("fail")).rejects.toThrow("write failed");
    await wrapped["GET /read"]("x");
    expect(calls.filter((call) => call.startsWith("read"))).toHaveLength(3);
  });

  it("refuses a policy that names a missing route", () => {
    expect(() =>
      withCooldown({ "GET /a": async () => 1 }, { reads: ["GET /b" as "GET /a"], writes: [] }, createQueryCooldown()),
    ).toThrow("No route named GET /b");
  });

  it("leaves other routes untouched", async () => {
    const { calls, wrapped, cooldown } = setup();
    await wrapped["GET /status"](undefined);
    await wrapped["GET /status"](undefined);
    expect(calls).toEqual(["status", "status"]);
    expect(cooldown.size).toBe(0);
  });
});
