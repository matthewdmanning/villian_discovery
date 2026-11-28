import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/** The live server, started for real with no Libby login saved, so every Libby call is refused before any network use. */
let base = "";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  process.env.LIBBY_SHELF_PORT = String(port);
  process.env.LIBBY_SHELF_RESTART = "1";
  process.env.LIBBY_TOKEN_FILE = join(mkdtempSync(join(tmpdir(), "libby-shelf-test-")), "token.json");
  delete process.env.LIBBY_IDENTITY_TOKEN;
  await import("../src/sync-server.js");
  for (let attempt = 0; attempt < 50; attempt++) {
    if (
      await fetch(`${base}/api/status`).then(
        (r) => r.ok,
        () => false,
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not start");
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("lists routes", () => {
  it("tells a signed-out user to connect Libby, as a JSON error", async () => {
    const lists = await fetch(`${base}/api/lists`);
    expect(lists.status).toBe(400);
    expect(await lists.json()).toEqual({ error: "Connect Libby first: run libby-shelf login" });
    const availability = await post("/api/lists/availability", { titleId: "42" });
    expect(availability.status).toBe(400);
    expect(await availability.json()).toEqual({ error: "Connect Libby first: run libby-shelf login" });
  });

  it("refuses requests from another website", async () => {
    const lists = await fetch(`${base}/api/lists`, { headers: { origin: "https://evil.example" } });
    expect(lists.status).toBe(403);
    const availability = await post("/api/lists/availability", { titleId: "42" }, { origin: "https://evil.example" });
    expect(availability.status).toBe(403);
  });

  it("answers the app's own origin the same as no origin", async () => {
    const lists = await fetch(`${base}/api/lists`, { headers: { origin: base } });
    expect(lists.status).toBe(400);
  });

  it("only offers each route by its own method", async () => {
    expect((await post("/api/lists", {})).status).toBe(404);
    expect((await fetch(`${base}/api/lists/availability`)).status).toBe(404);
  });

  it("no longer serves the retired in-app Libby sign-in", async () => {
    expect((await post("/api/login", {})).status).toBe(404);
    expect((await post("/api/login/device-code", {})).status).toBe(404);
    expect((await fetch(`${base}/api/login/device-code`)).status).toBe(404);
  });
});
