import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";
import { ActionSchema, MediaTypeSchema } from "./config.js";
import { InputError } from "./errors.js";
import type { MediaType } from "./types.js";
import { stripUndefined } from "./util.js";

/** One requested book. At least one of title, isbn or titleId is set. */
export interface BookRequest {
  /** Original line/entry, for reporting. */
  raw: string;
  title?: string;
  author?: string;
  isbn?: string;
  /** OverDrive title id; skips searching. */
  titleId?: string;
  mediaTypes?: MediaType[];
  action?: z.infer<typeof ActionSchema>;
  libraries?: string[];
}

export type InputFormat = "json" | "csv" | "tsv" | "text";

const listOf = <T extends z.ZodType>(item: T) => z.union([item.transform((v) => [v]), z.array(item)]);

const BookObjectSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    author: z.string().trim().min(1).optional(),
    isbn: z.string().trim().min(1).optional(),
    titleId: z.union([z.string(), z.number()]).transform(String).optional(),
    mediaTypes: listOf(MediaTypeSchema).optional(),
    format: listOf(MediaTypeSchema).optional(),
    action: ActionSchema.optional(),
    libraries: listOf(z.string()).optional(),
  })
  .strict()
  .refine((b) => b.title || b.isbn || b.titleId, "needs title, isbn or titleId");

const JsonInputSchema = z.union([
  z.array(z.union([z.string(), BookObjectSchema])),
  z.object({ books: z.array(z.union([z.string(), BookObjectSchema])) }).transform((o) => o.books),
]);

export async function readBooksFile(path: string, format?: InputFormat): Promise<BookRequest[]> {
  const text = path === "-" ? await readStdin() : await readFile(path, "utf8");
  return parseBooks(text, format ?? detectFormat(path));
}

export function detectFormat(path: string): InputFormat {
  const ext = extname(path).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".csv") return "csv";
  if (ext === ".tsv") return "tsv";
  return "text";
}

export function parseBooks(text: string, format: InputFormat): BookRequest[] {
  switch (format) {
    case "json":
      return parseJson(text);
    case "csv":
    case "tsv":
      return parseDelimited(text, format === "tsv" ? "\t" : ",");
    case "text":
      return text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map(parseBookLine);
  }
}

function parseJson(text: string): BookRequest[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new InputError(`Book list is not valid JSON: ${(e as Error).message}`);
  }
  const r = JsonInputSchema.safeParse(data);
  if (!r.success) throw new InputError(`Invalid book list:\n${z.prettifyError(r.error)}`);
  return r.data.map((entry) => {
    if (typeof entry === "string") return parseBookLine(entry);
    const { format, mediaTypes, isbn, ...rest } = entry;
    const types = mediaTypes ?? format;
    return stripUndefined({
      raw: JSON.stringify(entry),
      ...rest,
      ...(isbn ? { isbn: normalizeIsbn(isbn) ?? isbn } : {}),
      ...(types ? { mediaTypes: types } : {}),
    });
  });
}

const COLUMN_ALIASES: Record<string, keyof BookRequest> = {
  title: "title",
  name: "title",
  author: "author",
  creator: "author",
  isbn: "isbn",
  isbn13: "isbn",
  titleid: "titleId",
  id: "titleId",
  overdriveid: "titleId",
  format: "mediaTypes",
  mediatype: "mediaTypes",
  mediatypes: "mediaTypes",
  type: "mediaTypes",
  action: "action",
  library: "libraries",
  libraries: "libraries",
};

function parseDelimited(text: string, delimiter: string): BookRequest[] {
  let rows: Record<string, string>[];
  try {
    rows = parseCsv(text, {
      columns: (header: string[]) => header.map((h) => COLUMN_ALIASES[h.toLowerCase().replace(/[^a-z0-9]/g, "")] ?? h),
      delimiter,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (e) {
    throw new InputError(`Cannot parse book list: ${(e as Error).message}`);
  }
  return rows.map((row, i) => {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!v) continue;
      if (k === "mediaTypes" || k === "libraries")
        obj[k] = v
          .split(/[;|]/)
          .map((s) => s.trim())
          .filter(Boolean);
      else obj[k] = v;
    }
    const r = BookObjectSchema.safeParse(obj);
    if (!r.success) throw new InputError(`Row ${i + 2}: ${z.prettifyError(r.error)}`);
    const { format: _f, mediaTypes, isbn, ...rest } = r.data;
    return stripUndefined({
      raw: Object.values(row).filter(Boolean).join(delimiter),
      ...rest,
      ...(isbn ? { isbn: normalizeIsbn(isbn) ?? isbn } : {}),
      ...(mediaTypes ? { mediaTypes } : {}),
    });
  });
}

/**
 * Parses one free-text line. Accepted forms:
 * `isbn:9780593135204`, `9780593135204`, `id:5054011`, a Libby/OverDrive URL,
 * `Title by Author`, `Title - Author`, `Title — Author`, `Title | Author`, `Title<TAB>Author`, `Title`.
 */
export function parseBookLine(line: string): BookRequest {
  const raw = line.trim();
  const prefixed = PREFIX.exec(raw);
  if (prefixed) {
    const kind = (prefixed[1] ?? "").toLowerCase();
    const value = raw.slice(prefixed[0].length).trim();
    if (!value) throw new InputError(`Missing value after "${kind}:"`);
    if (kind === "isbn") {
      const isbn = normalizeIsbn(value);
      if (!isbn) throw new InputError(`Invalid ISBN: ${value}`);
      return { raw, isbn };
    }
    return { raw, titleId: value };
  }
  const urlId = titleIdFromUrl(raw);
  if (urlId) return { raw, titleId: urlId };
  const bareIsbn = normalizeIsbn(raw);
  if (bareIsbn) return { raw, isbn: bareIsbn };

  const parts = splitTitleAuthor(raw);
  if (parts) return { raw, title: parts[0], author: parts[1] };
  return { raw, title: raw };
}

// Regex-free parsing below: lines are untrusted input, so avoid backtracking patterns.
const PREFIX = /^(isbn|id|titleid|overdrive)\s*:/i;

/** Title id from a Libby or OverDrive title URL, e.g. share.libbyapp.com/title/123. */
export function titleIdFromUrl(s: string): string | undefined {
  if (!/^https?:\/\//i.test(s)) return undefined;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  const known = ["libbyapp.com", "overdrive.com"].some((d) => host === d || host.endsWith(`.${d}`));
  if (!known) return undefined;
  return url.pathname
    .split("/")
    .reverse()
    .find((seg) => /^\d+$/.test(seg));
}

/** Splits on TAB, then " | " / " — " / " – ", then " - ", then the last " by ". */
function splitTitleAuthor(raw: string): [string, string] | undefined {
  const tab = raw.indexOf("\t");
  if (tab >= 0) return pair(raw.slice(0, tab), raw.slice(tab + 1));
  const s = raw.replace(/\s+/g, " ");
  for (const seps of [[" | ", " — ", " – "], [" - "]]) {
    const hits = seps.map((sep) => [s.indexOf(sep), sep.length] as const).filter(([i]) => i >= 0);
    if (!hits.length) continue;
    const [i, len] = hits.reduce((a, b) => (b[0] < a[0] ? b : a));
    const p = pair(s.slice(0, i), s.slice(i + len));
    if (p) return p;
  }
  const by = s.toLowerCase().lastIndexOf(" by ");
  return by >= 0 ? pair(s.slice(0, by), s.slice(by + 4)) : undefined;
}

function pair(a: string, b: string): [string, string] | undefined {
  const x = a.trim();
  const y = b.trim();
  return x && y ? [x, y] : undefined;
}

/** Returns a digits-only ISBN-10/13 (X allowed last) or undefined. */
export function normalizeIsbn(s: string): string | undefined {
  const v = s.replace(/[\s-]/g, "").toUpperCase();
  return /^(\d{13}|\d{9}[\dX])$/.test(v) ? v : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
