import { expect, it } from "vitest";
import { exploreLinks } from "../src/discovery/capture.js";

it("exploreLinks keeps same-site pages and drops account-changing or external links", () => {
  expect(
    exploreLinks(
      [
        "https://fable.co/book/123#reviews",
        "https://app.fable.co/clubs",
        "https://fable.co/logout",
        "https://fable.co/settings/delete-account",
        "https://fable.co/x?action=unsubscribe",
        "https://evil.example/fable.co",
        "mailto:hi@fable.co",
        "not a url",
      ],
      ["fable.co"],
    ),
  ).toEqual(["https://fable.co/book/123", "https://app.fable.co/clubs"]);
});
