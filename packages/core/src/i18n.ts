/**
 * Texts the server produces (match reasons, file errors) travel in both languages and are
 * picked in the viewer's language by the UI: `\u0002` de `\u001f` en `\u0003`, possibly inside
 * other text. Plain text stays as it is.
 */
export type Lang = "de" | "en";

/** A text in both languages. */
export const tr = (de: string, en: string): string => `\u0002${de}\u001f${en}\u0003`;

export function localize(text: string, lang: Lang): string;
export function localize(text: string | null | undefined, lang: Lang): string | null;
export function localize(text: string | null | undefined, lang: Lang): string | null {
  if (text == null) return null;
  if (!text.includes("\u0002")) return text;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are the markers
  return text.replace(/\u0002([^\u001f\u0003]*)(?:\u001f([^\u0003]*))?(?:\u0003|$)/g, (_, de: string, en?: string) =>
    lang === "en" ? (en ?? de) : de,
  );
}

/** `de-DE`, `en-US`, … → the UI language; everything that is not German is English. */
export function langOf(locale: string | null | undefined): Lang {
  return locale?.toLowerCase().startsWith("de") ? "de" : "en";
}
