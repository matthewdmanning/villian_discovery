import { describe, expect, it } from "vitest";
import { type ConfigInput, parseConfig } from "../src/config.js";
import { HttpError, MutationUncertainError } from "../src/errors.js";
import { LibbyClient } from "../src/libby-client.js";
import { silentLogger } from "../src/logger.js";
import { Runner } from "../src/runner.js";
import { ThunderClient } from "../src/thunder-client.js";
import { card, fakeFetch, media } from "./fixtures.js";

const book = { raw: "Project Hail Mary", title: "Project Hail Mary" };
const ids = ["111", "222"].map((titleId) => ({ raw: `id:${titleId}`, titleId }));
function harness(config: ConfigInput = {}, routes: Parameters<typeof fakeFetch>[0] = []) {
  const transport = fakeFetch([
    ...routes,
    { match: /chip\/sync$/, respond: () => ({ body: { cards: [card()], loans: [], holds: [] } }) },
    {
      match: /thunder/,
      respond: (url) => {
        const id = /\/media\/(\d+)$/.exec(url.pathname)?.[1];
        return { body: id ? media({ id, isAvailable: true }) : { items: [media({ isAvailable: true })] } };
      },
    },
    { method: "POST", match: /\/(loan|hold)\//, respond: () => ({ body: {} }) },
    { method: "PUT", match: /\/hold\//, respond: () => ({ body: {} }) },
  ]);
  const cfg = parseConfig({ delayMs: 0, logLevel: "silent", ...config });
  const http = { ...cfg.http, retryBaseMs: 1, fetch: transport.fetch, logger: silentLogger };
  const runner = new Runner(cfg, {
    libby: new LibbyClient({ ...http, identityToken: "test" }),
    thunder: new ThunderClient(http),
    logger: silentLogger,
  });
  return { ...transport, runner };
}

describe("Libby audit regressions", () => {
  it.each(["borrow", "hold"] as const)("simulates the %s cap without writes", async (action) => {
    const { runner, calls } = harness({ dryRun: true, action, [action]: { maxPerRun: 1 } });
    expect((await runner.run(ids)).map((row) => row.status)).toEqual([`would-${action}`, "skipped"]);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("simulates existing titles and the last card slot", async () => {
    const duplicate = harness({ dryRun: true });
    expect((await duplicate.runner.run([book, book])).map((row) => row.status)).toEqual(["would-borrow", "skipped"]);
    const lastSlot = harness({ dryRun: true, action: "borrow" }, [
      { match: /sync/, respond: () => ({ body: { cards: [card({ counts: { loan: 9, hold: 0 } })] } }) },
    ]);
    expect((await lastSlot.runner.run(ids)).map((row) => row.status)).toEqual(["would-borrow", "skipped"]);
  });

  it("keeps available accepted formats and eligible editions for planning", async () => {
    const { runner } = harness({}, [
      {
        match: /thunder/,
        respond: () => ({
          body: { items: [media(), media({ id: "222", type: { id: "audiobook" }, isAvailable: true })] },
        }),
      },
    ]);
    expect(await runner.run([book])).toMatchObject([{ status: "borrowed", titleId: "222", mediaType: "audiobook" }]);
    const owned = harness({ action: "hold" }, [
      {
        match: /thunder/,
        respond: () => ({
          body: { items: [media({ isOwned: false, ownedCopies: 0 }), media({ id: "222", type: { id: "audiobook" } })] },
        }),
      },
    ]);
    expect(await owned.runner.run([book])).toMatchObject([{ status: "held", titleId: "222" }]);
  });

  it("falls back to title search when ISBN results are all rejected", async () => {
    const { runner, calls } = harness({ matching: { allowPreRelease: false } }, [
      {
        match: /thunder/,
        respond: (url) => ({
          body: { items: [media({ isPreReleaseTitle: url.searchParams.has("identifier"), isAvailable: true })] },
        }),
      },
    ]);
    expect(await runner.run([{ ...book, isbn: "9780593135204" }])).toMatchObject([{ status: "borrowed" }]);
    expect(calls.filter((call) => call.url.host.startsWith("thunder"))).toHaveLength(2);
  });

  it("refreshes availability on repeated searches and runs", async () => {
    let searches = 0;
    const { runner } = harness({ dryRun: true }, [
      { match: /thunder/, respond: () => ({ body: { items: [media({ isAvailable: ++searches > 1 })] } }) },
    ]);
    expect((await runner.run([book]))[0]?.status).toBe("would-hold");
    expect((await runner.run([book]))[0]?.status).toBe("would-borrow");
    expect(searches).toBe(2);
  });

  it("honors failFast before attempting another hold target", async () => {
    const { runner, calls } = harness({ failFast: true, action: "hold", hold: { placement: "all" } }, [
      { match: /sync/, respond: () => ({ body: { cards: [card(), card({ cardId: "200", advantageKey: "lib2" })] } }) },
      { method: "POST", match: /hold/, respond: () => ({ status: 400, body: { message: "hold rejected" } }) },
    ]);
    await expect(runner.run([book])).rejects.toThrow(/hold rejected/);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("emits the completed hold before a later authentication failure", async () => {
    const { runner } = harness({ action: "hold", hold: { placement: "all" } }, [
      { match: /sync/, respond: () => ({ body: { cards: [card(), card({ cardId: "200", advantageKey: "lib2" })] } }) },
      { method: "POST", match: /card\/200\/hold/, respond: () => ({ status: 401 }) },
    ]);
    const emitted: string[] = [];
    await expect(runner.run([book], (row) => emitted.push(row.status))).rejects.toBeInstanceOf(HttpError);
    expect(emitted).toEqual(["held"]);
  });

  it.each([401, 403])("stops after suspension HTTP %s while preserving the hold", async (status) => {
    const { runner, calls } = harness({ action: "hold", hold: { suspendDays: 7 } }, [
      { method: "PUT", match: /hold/, respond: () => ({ status }) },
    ]);
    const emitted: string[] = [];
    await expect(runner.run(ids, (row) => emitted.push(row.status))).rejects.toBeInstanceOf(HttpError);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(emitted).toEqual(["held"]);
  });

  it.each([false, true])("reports failed suspension and respects failFast=%s", async (failFast) => {
    const { runner } = harness({ failFast, action: "hold", hold: { suspendDays: 7 } }, [
      { method: "PUT", match: /hold/, respond: () => ({ status: 400, body: { message: "suspend rejected" } }) },
    ]);
    const emitted: string[] = [];
    const run = runner.run([book], (row) => emitted.push(row.status));
    if (failFast) {
      await expect(run).rejects.toThrow(/suspend rejected/);
      expect(emitted).toEqual(["held"]);
    } else {
      await run;
      expect(emitted).toEqual(["held", "error"]);
    }
  });

  it("reconciles a committed loan after a lost response without replaying the POST", async () => {
    let committed = false;
    const { runner, calls } = harness({ action: "borrow", borrow: { maxPerRun: 1 } }, [
      {
        match: /sync/,
        respond: () => ({ body: { cards: [card()], loans: committed ? [{ id: "111", cardId: "100" }] : [] } }),
      },
      {
        method: "POST",
        match: /loan/,
        respond: () => {
          committed = true;
          throw new TypeError("response lost");
        },
      },
    ]);
    expect((await runner.run(ids)).map((row) => row.status)).toEqual(["borrowed", "skipped"]);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("reconciles committed holds without replaying them", async () => {
    let committed = false;
    const { runner, calls } = harness({ action: "hold" }, [
      {
        match: /sync/,
        respond: () => ({ body: { cards: [card()], holds: committed ? [{ id: "111", cardId: "100" }] : [] } }),
      },
      {
        method: "POST",
        match: /hold/,
        respond: () => {
          committed = true;
          throw new TypeError("response lost");
        },
      },
    ]);
    expect(await runner.run([book])).toMatchObject([{ status: "held" }]);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it.each(["network", "server"])("aborts ambiguous %s outcomes without fallback holds", async (failure) => {
    const { runner, calls } = harness({}, [
      {
        method: "POST",
        match: /loan/,
        respond: () => {
          if (failure === "network") throw new TypeError("response lost");
          return { status: 503 };
        },
      },
    ]);
    await expect(runner.run(ids)).rejects.toBeInstanceOf(MutationUncertainError);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("does not turn unrelated borrow errors into holds", async () => {
    const { runner, calls } = harness({}, [
      {
        method: "POST",
        match: /loan/,
        respond: () => ({ status: 400, body: { upstream: { errorCode: "UnknownFailure" } } }),
      },
    ]);
    expect(await runner.run([book])).toMatchObject([{ status: "error" }]);
    expect(calls.some((call) => call.url.pathname.includes("/hold/"))).toBe(false);
  });
});

describe("LibbyClient.loanProgress", () => {
  const client = (body: unknown) => {
    const transport = fakeFetch([{ match: /\/card\/1\/audiobook\/data\/11$/, respond: () => ({ body }) }]);
    const http = { ...parseConfig({}).http, retryBaseMs: 1, fetch: transport.fetch, logger: silentLogger };
    return new LibbyClient({ ...http, identityToken: "test" });
  };
  const args = { cardId: "1", titleId: "11", mediaType: "audiobook" };

  it("returns percentageOfBook as a percent", async () => {
    expect(await client({ position: { percentageOfBook: 0.018220361 } }).loanProgress(args)).toBe(1.82);
  });

  it("returns undefined when Libby has no usable position", async () => {
    expect(await client({}).loanProgress(args)).toBeUndefined();
    expect(await client({ position: { percentageOfBook: 7 } }).loanProgress(args)).toBeUndefined();
  });
});
