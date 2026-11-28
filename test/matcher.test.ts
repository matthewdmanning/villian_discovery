import { describe, expect, it } from "vitest";
import { bestMatch, fuzzyKeywords, isbn13, normalizeName, normalizeTitle, toIsbn13 } from "../src/matcher.js";
import { media } from "./fixtures.js";

const opts = {
  minTitleScore: 0.85,
  minAuthorScore: 0.6,
  ignoreSubtitle: true,
  allowPreRelease: true,
  mediaTypes: ["ebook", "audiobook"],
};

describe("bestMatch", () => {
  it("matches title + author, ignoring case, articles and subtitles", () => {
    const items = [media({ id: "1", title: "The Martian: A Novel" }), media({ id: "2", title: "Project Hail Mary" })];
    expect(bestMatch({ raw: "", title: "martian", author: "Weir, Andy" }, items, opts)?.media.id).toBe("1");
  });

  it("rejects wrong author", () => {
    expect(bestMatch({ raw: "", title: "Project Hail Mary", author: "Jane Austen" }, [media()], opts)).toBeUndefined();
  });

  it("rejects dissimilar titles", () => {
    expect(bestMatch({ raw: "", title: "Artemis" }, [media()], opts)).toBeUndefined();
  });

  it("filters and ranks by media type preference", () => {
    const items = [
      media({ id: "a", type: { id: "audiobook" } }),
      media({ id: "e" }),
      media({ id: "m", type: { id: "magazine" } }),
    ];
    expect(bestMatch({ raw: "", title: "Project Hail Mary" }, items, opts)?.media.id).toBe("e");
    expect(bestMatch({ raw: "", title: "Project Hail Mary", mediaTypes: ["audiobook"] }, items, opts)?.media.id).toBe(
      "a",
    );
    expect(
      bestMatch({ raw: "", title: "Project Hail Mary", mediaTypes: ["magazine"] }, items.slice(0, 2), opts),
    ).toBeUndefined();
  });

  it("ISBN match wins regardless of title score; ISBN-10 matches ISBN-13", () => {
    const items = [media({ id: "x", title: "Something Else" }), media({ id: "y", title: "Other", formats: [] })];
    expect(bestMatch({ raw: "", isbn: "0593135202" }, items, opts)?.media.id).toBe("x");
  });

  it("titleId matches exactly", () => {
    expect(bestMatch({ raw: "", titleId: "111" }, [media()], opts)?.media.id).toBe("111");
    expect(bestMatch({ raw: "", titleId: "999" }, [media()], opts)).toBeUndefined();
  });

  it("can exclude pre-release titles", () => {
    const m = media({ isPreReleaseTitle: true });
    expect(
      bestMatch({ raw: "", title: "Project Hail Mary" }, [m], { ...opts, allowPreRelease: false }),
    ).toBeUndefined();
  });
});

it("normalizers", () => {
  expect(normalizeTitle("The Lord of the Rings: The Fellowship", true)).toBe("lord of the rings");
  expect(normalizeTitle("Café & Crème", false)).toBe("cafe and creme");
  expect(normalizeName("Weir, Andy")).toBe(normalizeName("Andy Weir"));
  expect(normalizeName("J. R. R. Tolkien")).toBe("tolkien");
  expect(toIsbn13("0593135202")).toBe("9780593135204");
  for (const spelling of ["0-593-13520-2", "isbn:978 0593135204", "9780593135204"])
    expect(isbn13(spelling)).toBe("9780593135204");
  expect(isbn13("not an isbn")).toBeUndefined();
});

it("preserves non-Latin titles and authors without matching unrelated books", () => {
  const chinese = media({ title: "三体", firstCreatorName: "刘慈欣" });
  expect(bestMatch({ raw: "", title: "三体", author: "刘慈欣" }, [chinese], opts)?.titleScore).toBe(1);
  expect(bestMatch({ raw: "", title: "活着", author: "余华" }, [chinese], opts)).toBeUndefined();
  expect(bestMatch({ raw: "", title: "()" }, [media({ title: "!!!" })], opts)).toBeUndefined();
  expect(normalizeName("余华")).toBe("余华");
  expect(bestMatch({ raw: "", title: "Война и мир" }, [media({ title: "Война и мир" })], opts)).toBeDefined();
});

it("compares authors rather than narrators or other contributors", () => {
  const title = media({
    creators: [
      { name: "Andy Weir", role: "Author" },
      { name: "Ray Porter", role: "Narrator" },
    ],
  });
  expect(bestMatch({ raw: "", title: title.title, author: "Ray Porter" }, [title], opts)).toBeUndefined();
  expect(bestMatch({ raw: "", title: title.title, author: "Andy Weir" }, [title], opts)).toBeDefined();
});

describe("fuzzyKeywords", () => {
  it("matches phrases, prefixes and words in any order", () => {
    expect(fuzzyKeywords("Project Hail Mary", "hail mary")).toBe(true);
    expect(fuzzyKeywords("Project Hail Mary", "mary project")).toBe(true);
    expect(fuzzyKeywords("Project Hail Mary", "proj")).toBe(true);
    expect(fuzzyKeywords("Café Society", "cafe")).toBe(true);
  });

  it("allows one typo from four letters and two from eight, including swapped letters", () => {
    expect(fuzzyKeywords("Andy Weir", "Wier")).toBe(true);
    expect(fuzzyKeywords("J. R. R. Tolkien", "Tolkein")).toBe(true);
    expect(fuzzyKeywords("Neverwhere", "Nevrwhree")).toBe(true);
    expect(fuzzyKeywords("Andy Weir", "Wxyz")).toBe(false);
    expect(fuzzyKeywords("Neverwhere", "Nxvxrwhxre")).toBe(false);
  });

  it("keeps short words and numbers exact", () => {
    expect(fuzzyKeywords("Death by Chocolate", "dy")).toBe(false);
    expect(fuzzyKeywords("Catch-22", "Catch 23")).toBe(false);
    expect(fuzzyKeywords("Catch-22", "Catch 22")).toBe(true);
  });

  it("never matches an empty query", () => {
    expect(fuzzyKeywords("Anything", "  ")).toBe(false);
  });
});
