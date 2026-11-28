import type { BookRecord } from "../../../src/book-metadata.ts";
import { type BookRequest, parseBookLine } from "../../../src/input.ts";
import type { ListItem } from "../../../src/libby-lists.ts";
import { fuzzyKeywords, normalizeName, normalizeTitle } from "../../../src/matcher.ts";

/**
 * Parse the text used by the list/search UI.
 *
 * The normal input forms deliberately remain delegated to parseBookLine.  The
 * UI additionally accepts `title:` and `author:` fields.  A field consumes
 * everything up to the next field, which makes unquoted multi-word values
 * useful while still allowing either field to be quoted.
 */
export function parseSearchQuery(text: string): BookRequest {
  const raw = text.trim();
  const fields = explicitFields(raw);
  if (!fields) {
    const parsed = parseBookLine(raw);
    // ISBNs and title IDs stay exact.
    if (parsed.isbn || parsed.titleId) return parsed;
    // Plain text keeps both readings: the literal phrase ("Death by Chocolate") and, when the line has one,
    // the legacy title-by-author split ("Project Hail Mary by Andy Weir").
    return { ...parsed, text: raw, matchMode: "text" };
  }

  const result: BookRequest = { raw, matchMode: "keywords" };
  if (fields.title) result.title = fields.title;
  if (fields.author) result.author = fields.author;
  return result;
}

/** Filter a tagged-list item using a parsed search request. Titles and authors match fuzzily; IDs exactly. */
export function matchesListSearch(item: ListItem, query: BookRequest): boolean {
  // ListItem has no ISBN.  Never claim an ISBN match based on unrelated text.
  if (query.isbn) return false;
  if (query.titleId) return item.id === query.titleId;
  const author = item.author ?? "";
  if (query.matchMode === "text") {
    const literal = query.text ?? query.title;
    if (literal && fuzzyKeywords(`${item.title} ${author}`, literal)) return true;
    return Boolean(
      query.title && query.author && fuzzyKeywords(item.title, query.title) && fuzzyKeywords(author, query.author),
    );
  }
  return (
    (!query.title || fuzzyKeywords(item.title, query.title)) && (!query.author || fuzzyKeywords(author, query.author))
  );
}

/** Use title and author identity because Libby taggings carry no edition ISBN. */
export function matchesIsbnBook(item: ListItem, book: Pick<BookRecord, "title" | "subtitle" | "authors">): boolean {
  const title = normalizeTitle(item.title, false);
  const bookTitle = normalizeTitle(book.title, false);
  const fullTitle = book.subtitle ? normalizeTitle(`${book.title} ${book.subtitle}`, false) : bookTitle;
  const author = item.author ? normalizeName(item.author) : "";
  // Either side may carry a subtitle the other lacks ("Piranesi" vs "Piranesi: A Novel").
  const mainTitle = normalizeTitle(item.title, true);
  return Boolean(
    title &&
      (title === bookTitle || title === fullTitle || (mainTitle && mainTitle === normalizeTitle(book.title, true))) &&
      author &&
      book.authors.some((name) => normalizeName(name) === author),
  );
}

type ExplicitFields = { title?: string; author?: string };
const FIELD = /^(title|author)\s*:/i;
const NEXT_FIELD = /\s(?=(?:title|author)\s*:)/i;

function explicitFields(raw: string): ExplicitFields | undefined {
  if (!FIELD.test(raw)) return undefined;
  const result: ExplicitFields = {};
  let text = raw;
  while (text) {
    const field = FIELD.exec(text);
    if (!field) throw new Error("Expected title: or author: after the quoted text.");
    const kind = field[1]!.toLowerCase() as keyof ExplicitFields;
    const rest = text.slice(field[0].length);
    const quoted = rest.trimStart();
    const quote = quoted[0];
    let value: string;
    if (quote === '"' || quote === "'") {
      const end = quoted.indexOf(quote, 1);
      if (end < 0) throw new Error(`Close the quote for ${kind}:.`);
      value = quoted.slice(1, end).trim();
      text = quoted.slice(end + 1).trimStart();
    } else {
      const end = NEXT_FIELD.exec(rest)?.index ?? rest.length;
      value = rest.slice(0, end).trim();
      text = rest.slice(end).trimStart();
    }
    if (!value) throw new Error(`Enter a value for ${kind}:.`);
    result[kind] = value;
  }
  return result;
}
