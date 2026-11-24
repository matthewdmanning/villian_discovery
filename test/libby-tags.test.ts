import { describe, expect, it } from "vitest";
import { LibbyClient } from "../src/libby-client.js";
import { silentLogger } from "../src/logger.js";
import { fakeFetch } from "./fixtures.js";

const options = { timeoutMs: 1000, retries: 0, retryBaseMs: 1, userAgent: "test", logger: silentLogger };

describe("experimental Libby tags read", () => {
  it("requests tags from Vandal with the current identity and preserves the response", async () => {
    const response = { tags: [{ name: "To read", extra: { unknown: true } }] };
    const transport = fakeFetch([
      { match: /^https:\/\/vandal\.libbyapp\.com\/tags$/, respond: () => ({ body: response }) },
    ]);
    const client = new LibbyClient({ ...options, fetch: transport.fetch, identityToken: "old" });
    client.identityToken = "current";
    expect(await client.tags()).toEqual(response);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toMatchObject({ method: "GET", headers: { Authorization: "Bearer current" } });
  });

  it("reports a failed read instead of treating it as an empty tag list", async () => {
    const transport = fakeFetch([{ match: /\/tags$/, respond: () => ({ status: 401, body: { message: "expired" } }) }]);
    const client = new LibbyClient({ ...options, fetch: transport.fetch, identityToken: "expired" });
    await expect(client.tags()).rejects.toThrow("401");
  });
});
