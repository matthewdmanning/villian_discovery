import { expect, it } from "vitest";
import { configFromEnv, mergeConfig, parseConfig } from "../src/config.js";

it("applies defaults", () => {
  const c = parseConfig({});
  expect(c).toMatchObject({
    action: "auto",
    mediaTypes: ["ebook", "audiobook"],
    dryRun: false,
    hold: { placement: "best", suspendDays: 0 },
  });
});

it("rejects unknown keys and bad values readably", () => {
  expect(() => parseConfig({ acton: "hold" })).toThrow(/Unrecognized key/);
  expect(() => parseConfig({ hold: { suspendDays: 45 } })).toThrow(/0-30, 60 or 90/);
});

it("merges layers deeply; later wins", () => {
  const m = mergeConfig(
    { hold: { placement: "all", suspendDays: 7 }, libraries: ["a", "b"] },
    { hold: { placement: "first" }, libraries: ["c"] },
  );
  expect(m).toEqual({ hold: { placement: "first", suspendDays: 7 }, libraries: ["c"] });
});

it("reads env", () => {
  expect(configFromEnv({ LIBBY_IDENTITY_TOKEN: "t", LIBBY_DRY_RUN: "true" })).toEqual({
    auth: { identityToken: "t" },
    dryRun: true,
  });
});

it("mergeConfig ignores prototype-polluting keys", () => {
  const evil = JSON.parse('{"__proto__": {"polluted": true}, "hold": {"constructor": {"x": 1}}}');
  const m = mergeConfig(evil) as Record<string, unknown>;
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(Object.getPrototypeOf(m)).toBe(Object.prototype);
  expect(Object.hasOwn(m.hold as object, "constructor")).toBe(false);
});
