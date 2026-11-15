import { detectFormat, type InputFormat, parseBooks } from "../../../src/input.ts";
import type { BookRequest } from "./api.ts";

export function parseBookDraft(
  text: string,
  format: "auto" | InputFormat,
  fileName?: string,
): { books: BookRequest[]; error?: string } {
  if (!text.trim()) return { books: [] };
  const fmt =
    format === "auto" ? (fileName ? detectFormat(fileName) : /^[[{]/.test(text.trimStart()) ? "json" : "text") : format;
  try {
    return { books: parseBooks(text, fmt) };
  } catch (e) {
    return { books: [], error: (e as Error).message };
  }
}
