import { expect, it } from "vitest";
import { parseConfig } from "../src/config.ts";
import { silentLogger } from "../src/logger.ts";
import { mediaHasIsbn, mediaNarrators } from "../src/matcher.ts";
import { Runner } from "../src/runner.ts";
import { ThunderClient } from "../src/thunder-client.ts";
import { groupSearchResults } from "../ui/src/lib/search-results.ts";

const live = it.skipIf(process.env.LIBBY_LIVE_CATALOG_TEST !== "1");

live(
  "groups alternate ISBN editions from the public OverDrive catalog",
  async () => {
    const isbn = "9780553904666";
    const audiobookIsbn = "9780792776888";
    const cards = [
      { cardId: "test-lapl", advantageKey: "lapl" },
      { cardId: "test-nypl", advantageKey: "nypl" },
    ];
    const config = parseConfig({ libraries: cards.map((card) => card.advantageKey) });
    const thunder = new ThunderClient({ ...config.http, logger: silentLogger });
    const runner = new Runner(config, { thunder, logger: silentLogger });

    const matches = await runner.searchMatches({ raw: isbn, isbn }, cards);
    const groups = groupSearchResults(matches, config.libraries, config.mediaTypes);
    const book = groups.find((group) => group.matches.some(({ media }) => mediaHasIsbn(media, isbn)));

    expect(book?.title).toBe("The Woman in White");
    expect(book?.author).toMatch(/^Wilkie Collins$/i);
    expect(
      groups.filter((group) => group.matches.some(({ media }) => mediaHasIsbn(media, audiobookIsbn))),
    ).toHaveLength(1);
    expect(
      book?.matches.some(({ media }) => media.type?.id === "audiobook" && mediaHasIsbn(media, audiobookIsbn)),
    ).toBe(true);
    expect(book?.matches.some(({ card, media }) => card.advantageKey === "nypl" && !mediaHasIsbn(media, isbn))).toBe(
      true,
    );

    const audiobook = book?.matches.find(({ media }) => mediaHasIsbn(media, audiobookIsbn));
    expect(mediaNarrators(audiobook?.media ?? {})).toContain("Ian Holm");
    const details = await thunder.getLibraryMedia("lapl", "504939");
    expect(mediaNarrators(details)).toContain("Ian Holm");
  },
  25_000,
);

live(
  "confirms Dune editions while excluding similar titles and the same-title graphic adaptation",
  async () => {
    const card = { cardId: "test-nypl", advantageKey: "nypl" };
    const config = parseConfig({ libraries: [card.advantageKey] });
    const thunder = new ThunderClient({ ...config.http, logger: silentLogger });
    const runner = new Runner(config, { thunder, logger: silentLogger });
    const cases = [
      {
        isbn: "9780553897821",
        query: "House Atreides Brian Herbert",
        expected: ["33309", "253024"],
        excluded: "5962020", // Dune: House Atreides (2020), Issue 3
      },
      {
        isbn: "9781101658055",
        query: "Dune Frank Herbert",
        expected: ["1243691", "217929"],
        excluded: "5318037", // Dune graphic adaptation with two additional credited authors
      },
    ];
    for (const { isbn, query, expected, excluded } of cases) {
      const [catalog, matches] = await Promise.all([
        thunder.searchLibrary(card.advantageKey, { query, mediaTypes: config.mediaTypes }),
        runner.searchMatches({ raw: isbn, isbn }, [card]),
      ]);
      expect(catalog.map(({ id }) => id)).toContain(excluded);
      const ids = matches.map(({ media }) => media.id);
      expect(ids).toEqual(expect.arrayContaining(expected));
      expect(ids).not.toContain(excluded);
    }
  },
  25_000,
);
