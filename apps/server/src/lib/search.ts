/**
 * Readers for `validateSearch`. Route options end up in the initial client bundle, so they use
 * these instead of zod (about 85 kB). A value of the wrong type is dropped, as if it were missing.
 */
export type Search = Record<string, unknown>;

export const searchString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export const searchBoolean = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** Numbers come parsed from the URL; strings like "12" are accepted too. */
export function searchNumber(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

export function searchEnum<const T extends string>(values: readonly T[]) {
  return (v: unknown): T | undefined => (values.includes(v as T) ? (v as T) : undefined);
}
