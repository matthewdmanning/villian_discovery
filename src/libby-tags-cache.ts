export type LibbyTag = {
  name: string;
  uuid: string;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTagList(value: unknown): LibbyTag[] {
  if (!Array.isArray(value)) throw new Error("Libby tags response had no valid tags list");
  return value.map((tag, index) => {
    if (
      !isRecord(tag) ||
      typeof tag.name !== "string" ||
      !tag.name.trim() ||
      typeof tag.uuid !== "string" ||
      !tag.uuid.trim()
    ) {
      throw new Error(`Libby tags response had an invalid tag at index ${index}`);
    }
    return tag as LibbyTag;
  });
}

/** Use this function to validate the Libby tags envelope while retaining unknown tag fields. Inputs are the untrusted API value; dependencies are `parseTagList`. */
export function parseTagsResponse(value: unknown): LibbyTag[] {
  if (!isRecord(value)) throw new Error("Libby tags response was not an object");
  return parseTagList(value.tags);
}

/** Use this function to identify a Libby account from stable card identities without persisting a token. Inputs are cards with `cardId` and `advantageKey`; dependencies are stable string sorting and JSON serialization. */
export function libbyAccountKey(cards: ReadonlyArray<Readonly<{ cardId: string; advantageKey: string }>>): string {
  return `cards:${JSON.stringify(
    cards
      .map(({ cardId, advantageKey }) => [cardId, advantageKey] as const)
      .sort(
        ([cardIdA, libraryA], [cardIdB, libraryB]) =>
          cardIdA.localeCompare(cardIdB) || libraryA.localeCompare(libraryB),
      ),
  )}`;
}

/** Use this function to read cached tags for the active account only. Inputs are the storage value and stable account key; dependencies are `parseTagList`. */
export function cachedTagsForAccount(value: unknown, accountKey: string): LibbyTag[] | undefined {
  if (!isRecord(value)) return undefined;
  const saved = value[accountKey];
  return saved === undefined ? undefined : parseTagList(saved);
}

/** Use this function to update one account's tag cache while discarding legacy unscoped arrays. Inputs are the storage value, stable account key, and validated tags; dependencies are plain object storage semantics. */
export function storeTagsForAccount(value: unknown, accountKey: string, tags: LibbyTag[]): Record<string, unknown> {
  const cache = isRecord(value) ? { ...value } : {};
  cache[accountKey] = tags;
  return cache;
}
