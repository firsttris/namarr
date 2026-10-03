/**
 * The interface language. The texts live in messages/{de,en}.json and are compiled by Paraglide
 * to src/paraglide: components call them directly (m.settings_title()).
 *
 * The server decides the first render (cookie, else Accept-Language) and renders each request in
 * its own language (lang.server.ts keeps it per request); the browser keeps the language of the
 * page. A change in the UI is saved in the `namarr_lang` cookie and reloads the page.
 *
 * Texts the server produces travel as keys (msg() in @namarr/core/i18n) and are rendered here.
 */
import { type Lang, localize, type MsgInputs } from "@namarr/core/i18n";
import { createContext, type ReactNode, useCallback, useContext } from "react";
import * as m from "~/paraglide/messages";
import { overwriteGetLocale } from "~/paraglide/runtime";

export type { Lang };
export const LANGS: { id: Lang; label: string }[] = [
  { id: "de", label: "Deutsch" },
  { id: "en", label: "English" },
];

export const LANG_COOKIE = "namarr_lang";

let clientLang: Lang = "en";
// On globalThis: the server installs the per-request language (lang.server.ts).
const g = globalThis as unknown as { __namarrLang?: () => Lang | undefined };

/** Server: where the language of the current request comes from. */
export function setLangResolver(resolve: () => Lang | undefined) {
  g.__namarrLang = resolve;
}

/** The language the current render or request uses. */
export function currentLang(): Lang {
  return g.__namarrLang?.() ?? clientLang;
}

// Paraglide's m.*() ask getLocale(): answer with the same source as everything else.
overwriteGetLocale(() => currentLang());

/** Intl locale of a language. */
export const localeOf = (lang: Lang = currentLang()) => (lang === "de" ? "de-DE" : "en-US");

const LangContext = createContext<Lang>("en");

export function LangProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  clientLang = initial;
  return <LangContext.Provider value={initial}>{children}</LangContext.Provider>;
}

/** Saves the choice and reloads, so every text, including live data, comes in the new language. */
export function switchLang(lang: Lang) {
  // biome-ignore lint/suspicious/noDocumentCookie: a plain preference cookie, read again by the server
  document.cookie = `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  location.reload();
}

/** The current language and its setter. */
export function useLang(): { lang: Lang; setLang: (lang: Lang) => void } {
  return { lang: useContext(LangContext), setLang: switchLang };
}

const messages = m as unknown as Record<string, ((inputs: MsgInputs, options: { locale: Lang }) => string) | undefined>;

/** Renders the messages in a text the server produced; plain text stays as it is. */
export function localizeIn(text: string, lang: Lang): string;
export function localizeIn(text: string | null | undefined, lang: Lang): string | null;
export function localizeIn(text: string | null | undefined, lang: Lang): string | null {
  return localize(text, lang, (key, inputs, l) => messages[key]?.(inputs, { locale: l }));
}

/** localizeIn() in the language of the page. */
export function useLocalize(): (text: string | null | undefined) => string {
  const lang = useContext(LangContext);
  return useCallback((text) => localizeIn(text, lang) ?? "", [lang]);
}

/** A message picked by a runtime key (status, action …); unknown keys come back as they are. */
export function pickMsg(map: Record<string, () => string>, key: string): string {
  return map[key]?.() ?? key;
}
