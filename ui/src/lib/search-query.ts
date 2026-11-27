import { type BookRequest, parseBookLine } from "../../../src/input.ts";
import type { ListItem } from "../../../src/libby-lists.ts";
import { containsKeywords } from "../../../src/matcher.ts";

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
    // A bare UI keyword should be searched as a title/author keyword by the
    // catalog runner as well as by matchesListSearch. Keep legacy structured
    // forms unchanged.
    if (parsed.title && !parsed.author && !parsed.isbn && !parsed.titleId) return { ...parsed, matchMode: "text" };
    return parsed;
  }

  const result: BookRequest = { raw, matchMode: "keywords" };
  if (fields.title) result.title = fields.title;
  if (fields.author) result.author = fields.author;
  return result;
}

/** Filter a tagged-list item using a parsed search request. */
export function matchesListSearch(item: ListItem, query: BookRequest): boolean {
  // ListItem has no ISBN.  Never claim an ISBN match based on unrelated text.
  if (query.isbn) return false;
  if (query.titleId) return item.id === query.titleId;
  const author = item.author ?? "";
  if (query.matchMode === "text" && query.title) {
    return containsKeywords(item.title, query.title) || containsKeywords(author, query.title);
  }
  return (
    (!query.title || containsKeywords(item.title, query.title)) &&
    (!query.author || containsKeywords(author, query.author))
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
