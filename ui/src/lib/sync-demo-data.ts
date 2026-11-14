import type { BookSnapshot } from "../../../src/sync.ts";

/** Synthetic account data only; no provider credentials or real shelf data. */
export const DEMO_SYNC_SNAPSHOTS = {
  libby: [
    {
      bookId: "libby:piranesi-ebook",
      workId: "isbn:9781635575637",
      title: "Piranesi",
      author: "Susanna Clarke",
      fields: {
        readingProgress: { value: 45, updatedAt: "2026-11-10T10:00:00Z", visibility: "private" },
        checkedOut: { value: true, visibility: "private" },
        finished: { value: false, visibility: "private" },
        rating: { value: 4, updatedAt: "2026-11-10T10:00:00Z", visibility: "private" },
        notes: { value: "Read the ending again", updatedAt: "2026-11-13T10:00:00Z", visibility: "private" },
        shelves: { value: ["Favorites"], updatedAt: "2026-11-12T10:00:00Z", visibility: "private" },
      },
    },
    {
      bookId: "libby:piranesi-audio",
      workId: "isbn:9781635575637",
      title: "Piranesi",
      author: "Susanna Clarke",
      fields: {
        readingProgress: { value: 65, updatedAt: "2026-11-11T10:00:00Z", visibility: "private" },
        checkedOut: { value: false, visibility: "private" },
        finished: { value: false, visibility: "private" },
      },
    },
    {
      bookId: "libby:dune",
      workId: "isbn:9780441172719",
      title: "Dune",
      author: "Frank Herbert",
      knownFields: ["notes"],
      fields: {
        readingProgress: { value: 100, visibility: "private" },
        checkedOut: { value: true, visibility: "private" },
        finished: { value: true, visibility: "private" },
      },
    },
  ],
  fable: [
    {
      bookId: "fable:piranesi",
      workId: "isbn:9781635575637",
      title: "Piranesi",
      author: "Susanna Clarke",
      fields: {
        readingProgress: { value: 80, updatedAt: "2026-11-14T10:00:00Z", visibility: "private" },
        readingStatus: { value: "currently-reading", visibility: "private" },
        rating: { value: 5, updatedAt: "2026-11-13T10:00:00Z", visibility: "private" },
        notes: { value: "Read with the book club", updatedAt: "2026-11-10T10:00:00Z", visibility: "private" },
        shelves: { value: ["Book club"], updatedAt: "2026-11-12T10:00:00Z", visibility: "public" },
      },
    },
    {
      bookId: "fable:dune",
      workId: "isbn:9780441172719",
      title: "Dune",
      author: "Frank Herbert",
      fields: {
        readingProgress: { value: 20, visibility: "private" },
        readingStatus: { value: "currently-reading", visibility: "private" },
        notes: { value: "Discuss at next meeting", updatedAt: "2026-11-13T10:00:00Z", visibility: "private" },
      },
    },
  ],
} satisfies { libby: BookSnapshot[]; fable: BookSnapshot[] };
