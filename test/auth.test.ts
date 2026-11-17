import { expect, it } from "vitest";
import { identityFromLibbyStorage } from "../src/auth.js";
import { type BrowserSession, openSite } from "../src/discovery/browser.js";

it("reuses an open Libby tab, so Libby sees one device", async () => {
  const tab = (url: string) => ({ url: () => url, goto: async () => {} });
  const libby = tab("https://libbyapp.com/interview/welcome");
  const blank = tab("about:blank");
  let opened = 0;
  const session = {
    page: blank,
    context: {
      pages: () => [blank, libby],
      newPage: async () => {
        opened++;
        return tab("about:blank");
      },
    },
  } as unknown as BrowserSession;
  expect(await openSite(session, "https://libbyapp.com/")).toBe(libby);
  expect(await openSite(session, "https://fable.co/library")).toBe(blank);
  expect(opened).toBe(0);
});

it("reads Libby's stored identity whether raw or JSON-quoted", () => {
  expect(identityFromLibbyStorage("abc.def")).toBe("abc.def");
  expect(identityFromLibbyStorage('"abc.def"')).toBe("abc.def");
  expect(identityFromLibbyStorage(null)).toBeUndefined();
  expect(identityFromLibbyStorage('""')).toBeUndefined();
  expect(identityFromLibbyStorage("{}")).toBeUndefined();
});
