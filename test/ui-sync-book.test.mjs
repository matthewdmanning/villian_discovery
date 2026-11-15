import { expect, it } from "vitest";
import { summarizeBooks } from "../ui/src/components/SyncBook.tsx";

const row = (groupId, field, value) => ({
  bookId: groupId,
  groupId,
  title: groupId,
  field,
  value,
  source: "libby",
});

it("derives reading status and lists checked-out books first", () => {
  const books = summarizeBooks([
    row("unopened", "readingProgress", 0),
    row("dnf", "readingProgress", 40),
    row("dnf", "readingStatus", null),
    row("reading", "readingProgress", 30),
    row("reading", "checkedOut", true),
    row("done", "finished", true),
  ]);
  expect(books.map((book) => [book.title, book.status])).toEqual([
    ["reading", "progress"],
    ["unopened", "unopened"],
    ["dnf", "dnf"],
    ["done", "finished"],
  ]);
});
