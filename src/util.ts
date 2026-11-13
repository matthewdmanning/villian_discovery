/** `T` with `undefined`-valued keys made optional and non-undefined. */
export type StripUndefined<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** Drops keys whose value is undefined (for exactOptionalPropertyTypes). */
export function stripUndefined<T extends object>(o: T): StripUndefined<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as StripUndefined<T>;
}
