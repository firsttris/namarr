/**
 * Texts the server produces (match reasons, file errors) do not know the viewer's language.
 * They travel as a message key with its inputs, `\u0002["key",{…}]\u0003`, possibly inside other
 * text, and are rendered in the viewer's language later: by the UI, or by the server for a
 * notification or an API answer. The texts themselves live in apps/server/messages/*.json
 * (Paraglide). Plain text stays as it is.
 *
 * Entries stored by older versions carry both texts instead: `\u0002` de `\u001f` en `\u0003`.
 */
export type Lang = "de" | "en";

export type MsgInputs = Record<string, string | number>;

/** A message by key, rendered later in the viewer's language; see the top of this file. */
export const msg = (key: string, inputs: MsgInputs = {}): string => `\u0002${JSON.stringify([key, inputs])}\u0003`;

/** Renders one message; undefined for an unknown key. */
export type MsgRender = (key: string, inputs: MsgInputs, lang: Lang) => string | undefined;

// biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are the markers
const MARKED = /\u0002([^\u001f\u0003]*)(?:\u001f([^\u0003]*))?(?:\u0003|$)/g;

export function localize(text: string, lang: Lang, render: MsgRender): string;
export function localize(text: string | null | undefined, lang: Lang, render: MsgRender): string | null;
export function localize(text: string | null | undefined, lang: Lang, render: MsgRender): string | null {
  if (text == null) return null;
  if (!text.includes("\u0002")) return text;
  return text.replace(MARKED, (whole, body: string, en?: string) => {
    if (en === undefined && body.startsWith("[")) {
      try {
        const [key, inputs] = JSON.parse(body) as [string, MsgInputs | undefined];
        // Inputs can be messages themselves (a reason inside an error).
        const resolved = Object.fromEntries(
          Object.entries(inputs ?? {}).map(([k, v]) => [k, typeof v === "string" ? localize(v, lang, render) : v]),
        );
        return render(key, resolved, lang) ?? key;
      } catch {
        return whole;
      }
    }
    return lang === "en" ? (en ?? body) : body;
  });
}

/** `de-DE`, `en-US`, … → the UI language; everything that is not German is English. */
export function langOf(locale: string | null | undefined): Lang {
  return locale?.toLowerCase().startsWith("de") ? "de" : "en";
}
