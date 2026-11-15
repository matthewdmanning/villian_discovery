import { describe, expect, it } from "vitest";
import { loginWithDeviceCode, loginWithSetupCode } from "../src/auth.js";
import { LibbyClient } from "../src/libby-client.js";
import { silentLogger } from "../src/logger.js";
import { card, fakeFetch } from "./fixtures.js";

function pairing(options: { fulfilled?: boolean; blessing?: string } = { fulfilled: true, blessing: "approval" }) {
  let chips = 0;
  let polls = 0;
  const transport = fakeFetch([
    {
      method: "POST",
      match: /\/chip\?/,
      respond: () => ({ body: { identity: ++chips === 1 ? "anonymous" : "linked" } }),
    },
    {
      method: "GET",
      match: /\/chip\/clone\/code/,
      respond: () => ({
        body:
          options.fulfilled && ++polls >= 3
            ? { result: "fulfilled", blessing: options.blessing }
            : { code: polls < 2 ? "12345678" : "87654321", expiry: 2_000_000_000 + polls },
      }),
    },
    { method: "POST", match: /\/chip\/clone\/code/, respond: () => ({ body: { blessing: options.blessing } }) },
    { method: "POST", match: /\/chip\/clone$/, respond: () => ({ body: {} }) },
    { match: /\/chip\/sync/, respond: () => ({ body: { cards: [card()] } }) },
  ]);
  return {
    ...transport,
    client: new LibbyClient({
      timeoutMs: 1000,
      retries: 0,
      retryBaseMs: 1,
      userAgent: "test",
      logger: silentLogger,
      fetch: transport.fetch,
      identityToken: "previous",
    }),
  };
}

describe("receiving-device pairing", () => {
  it("displays rotated codes, polls approval, completes the clone and refreshes identity", async () => {
    const { client, calls } = pairing();
    const codes: string[] = [];
    await expect(loginWithDeviceCode(client, { pollIntervalMs: 0, onCode: (code) => codes.push(code) })).resolves.toBe(
      "linked",
    );
    expect(codes).toEqual(["12345678", "87654321"]);
    expect(client.identityToken).toBe("linked");
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/chip",
      "/chip/clone/code",
      "/chip/clone/code",
      "/chip/clone/code",
      "/chip/clone",
      "/chip",
      "/chip/sync",
    ]);
    expect(calls[0]?.headers.Authorization).toBeUndefined();
    expect(calls[1]?.url.searchParams.get("role")).toBe("pointer");
    expect(calls[2]?.url.searchParams.get("code")).toBe("12345678");
    expect(calls[4]?.body).toBe("blessing=approval");
    expect(calls.at(-1)?.headers.Authorization).toBe("Bearer linked");
  });

  it("times out without replacing the existing identity or completing the clone", async () => {
    const { client, calls } = pairing({ fulfilled: false });
    await expect(
      loginWithDeviceCode(client, { timeoutMs: 20, pollIntervalMs: 1000, onCode: () => {} }),
    ).rejects.toThrow(/timed out/);
    expect(client.identityToken).toBe("previous");
    expect(calls.some((call) => call.url.pathname === "/chip/clone")).toBe(false);
  });

  it("cancels while waiting and restores the existing identity", async () => {
    const { client, calls } = pairing({ fulfilled: false });
    const controller = new AbortController();
    await expect(
      loginWithDeviceCode(client, {
        signal: controller.signal,
        onCode: () => controller.abort(new Error("cancelled")),
      }),
    ).rejects.toThrow();
    expect(client.identityToken).toBe("previous");
    expect(calls).toHaveLength(2);
  });

  it("rejects unapproved codes without pretending they linked an account", async () => {
    const { client, calls } = pairing({ fulfilled: true });
    await expect(loginWithSetupCode(client, "12345678")).rejects.toThrow(/approval/);
    expect(client.identityToken).toBe("previous");
    expect(calls.some((call) => call.url.pathname === "/chip/sync")).toBe(false);
  });
});
