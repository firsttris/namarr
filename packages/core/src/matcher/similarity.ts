/** Lower case, no diacritics, `&` as `and`, punctuation as spaces. */
export function normalizeTitle(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(the|a|an|der|die|das) /, "")
    .trim();
}

export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  return (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
}

export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  const j = jaro(a, b);
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return j + prefix * prefixScale * (1 - j);
}

/** Jaro-Winkler on normalized titles. */
export function titleSimilarity(a: string, b: string): number {
  return jaroWinkler(normalizeTitle(a), normalizeTitle(b));
}
