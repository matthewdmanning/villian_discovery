import { expect, it } from "vitest";
import { identityFromLibbyStorage } from "../src/auth.js";

it("reads Libby's stored identity whether raw or JSON-quoted", () => {
  expect(identityFromLibbyStorage("abc.def")).toBe("abc.def");
  expect(identityFromLibbyStorage('"abc.def"')).toBe("abc.def");
  expect(identityFromLibbyStorage(null)).toBeUndefined();
  expect(identityFromLibbyStorage('""')).toBeUndefined();
  expect(identityFromLibbyStorage("{}")).toBeUndefined();
});
