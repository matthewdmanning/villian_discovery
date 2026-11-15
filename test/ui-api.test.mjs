import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.ts";
import { demoApi } from "../ui/src/lib/api.ts";

describe("demoApi.run", () => {
  it("keeps duplicate books with different media overrides independent", async () => {
    const config = parseConfig({ delayMs: 0, action: "hold", libraries: ["lib1"], skipExisting: false });
    const book = { raw: "Dune", title: "Dune" };
    const results = await demoApi.run(
      [
        { ...book, mediaTypes: ["ebook"] },
        { ...book, mediaTypes: ["audiobook"] },
      ],
      config,
    );
    expect(results.map(({ status, mediaType }) => [status, mediaType])).toEqual([
      ["held", "ebook"],
      ["held", "audiobook"],
    ]);
  });
  it("enforces hold limits across books in one run", async () => {
    const config = parseConfig({ delayMs: 0, action: "hold", hold: { placement: "first", maxPerRun: 1 } });
    const results = await demoApi.run(
      [
        { raw: "one", title: "One" },
        { raw: "two", title: "Two" },
      ],
      config,
    );

    expect(results.map((result) => result.status)).toEqual(["held", "skipped"]);
    expect(results[1]?.message).toContain("hold limit for this run reached");
  });

  it("uses placement and card limits when placing holds", async () => {
    const config = parseConfig({ delayMs: 0, action: "hold", hold: { placement: "all" } });
    const results = await demoApi.run([{ raw: "one", title: "One" }], config);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "held", library: "lib1", cardId: "1001" });
  });

  it("preserves exact title-id and ISBN lookup behavior", async () => {
    const config = parseConfig({ delayMs: 0, action: "hold", libraries: ["lib1"] });
    const exact = await demoApi.run([{ raw: "id:5054011", titleId: "5054011" }], config);
    const isbn = await demoApi.run([{ raw: "9780593135204", isbn: "9780593135204" }], config);

    expect(exact[0]).toMatchObject({ status: "held", titleId: "5054011", library: "lib1" });
    expect(isbn[0]).toMatchObject({ status: "held", mediaType: "ebook", library: "lib1" });
  });

  it("preserves dry-run statuses and preferred media types", async () => {
    const config = parseConfig({
      delayMs: 0,
      action: "hold",
      dryRun: true,
      mediaTypes: ["audiobook", "ebook"],
      hold: { placement: "first", maxPerRun: 1 },
    });
    const results = await demoApi.run(
      [
        { raw: "one", title: "One" },
        { raw: "two", title: "Two" },
      ],
      config,
    );

    expect(results.map((result) => result.status)).toEqual(["would-hold", "skipped"]);
    expect(results[0].mediaType).toBe("audiobook");
  });

  it("uses the selected card lending period for a borrow", async () => {
    const config = parseConfig({ delayMs: 0, libraries: ["lib2"], borrow: { lendingPeriod: "preference" } });
    const book = { raw: "Borrow A", title: "Borrow A", mediaTypes: ["audiobook"] };
    const results = await demoApi.run([book], config);
    expect(results[0]).toMatchObject({ status: "borrowed", mediaType: "audiobook", library: "lib2", loanDays: 14 });
    const shorter = await demoApi.run([book], { ...config, borrow: { ...config.borrow, lendingPeriod: 7 } });
    expect(shorter[0]).toMatchObject({ status: "borrowed", loanDays: 7 });
  });
});
