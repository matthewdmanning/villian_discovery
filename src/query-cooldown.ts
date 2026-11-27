/** How long a finished external read is reused before Libby, Fable or a library catalog is asked again. */
export const EXTERNAL_QUERY_COOLDOWN_MS = 10_000;

type Entry = { value: Promise<unknown>; settledAt?: number };

/**
 * Share external reads: identical requests made while one is in flight, or within `ms` after it succeeds,
 * get the same result instead of a new call. Failures are never kept, so a retry reaches the service.
 */
export function createQueryCooldown(ms: number = EXTERNAL_QUERY_COOLDOWN_MS, now: () => number = Date.now) {
  const entries = new Map<string, Entry>();
  const fresh = (entry: Entry) => entry.settledAt === undefined || now() - entry.settledAt < ms;

  function run<T>(key: string, load: () => Promise<T>): Promise<T> {
    for (const [known, entry] of entries) if (!fresh(entry)) entries.delete(known);
    const known = entries.get(key);
    if (known) return known.value as Promise<T>;
    const entry: Entry = { value: Promise.resolve() };
    const value = Promise.resolve()
      .then(load)
      .then(
        (result) => {
          entry.settledAt = now();
          return result;
        },
        (error: unknown) => {
          if (entries.get(key) === entry) entries.delete(key);
          throw error;
        },
      );
    entry.value = value;
    entries.set(key, entry);
    return value;
  }

  return {
    run,
    /** Forget every kept result, so the next read reaches the service. Call after any write. */
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
}

export type QueryCooldown = ReturnType<typeof createQueryCooldown>;
export type Route = (input: unknown) => Promise<unknown>;

/**
 * Wrap API routes: `reads` share results through `cooldown`, keyed by route and input;
 * `writes` forget every kept result once they finish, whether or not they succeed.
 */
export function withCooldown<R extends Record<string, Route>>(
  routes: R,
  policy: { reads: readonly (keyof R & string)[]; writes: readonly (keyof R & string)[] },
  cooldown: QueryCooldown,
): R {
  for (const name of [...policy.reads, ...policy.writes])
    if (typeof routes[name] !== "function") throw new Error(`No route named ${name}`);
  const wrapped: Record<string, Route> = { ...routes };
  for (const name of policy.reads) {
    const route = routes[name]!;
    wrapped[name] = (input) => cooldown.run(`${name} ${JSON.stringify(input ?? null)}`, () => route(input));
  }
  for (const name of policy.writes) {
    const route = routes[name]!;
    wrapped[name] = async (input) => {
      try {
        return await route(input);
      } finally {
        cooldown.clear();
      }
    };
  }
  return wrapped as R;
}
