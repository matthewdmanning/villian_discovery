/** Key under which libbyapp.com keeps its identity token in `localStorage`. */
export const LIBBY_IDENTITY_KEY = "dewey:sentry.identity";

/** Use this function to read the identity token from libbyapp.com's `dewey:sentry.identity` storage value, which may be raw or JSON-quoted. */
export function identityFromLibbyStorage(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" && parsed ? parsed : undefined;
  } catch {
    return raw;
  }
}
