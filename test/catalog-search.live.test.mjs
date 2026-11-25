import { expect, it } from "vitest";
import { parseConfig } from "../src/config.ts";
import { silentLogger } from "../src/logger.ts";
import { mediaHasIsbn, mediaNarrators } from "../src/matcher.ts";
import { Runner } from "../src/runner.ts";
import { ThunderClient } from "../src/thunder-client.ts";
import { groupSearchResults } from "../ui/src/lib/search-results.ts";

it.skipIf(process.env.LIBBY_LIVE_CATALOG_TEST !== "1")(
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
