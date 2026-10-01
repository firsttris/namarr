/**
 * The interface language. The server decides the first render (cookie, else Accept-Language),
 * so SSR and hydration agree; a change in the UI is kept in the `namarr_lang` cookie.
 * Per React context, not module state: one server renders requests in different languages.
 */
import { localize as localizeIn } from "@namarr/core/i18n";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { type Lang, type Messages, messages } from "./messages";

export { LANGS, type Lang, type Messages } from "./messages";

export const LANG_COOKIE = "namarr_lang";

type LangState = { lang: Lang; setLang: (lang: Lang) => void };
const LangContext = createContext<LangState>({ lang: "en", setLang: () => {} });

export function LangProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setState] = useState<Lang>(initial);
  const setLang = useCallback((next: Lang) => {
    setState(next);
    // biome-ignore lint/suspicious/noDocumentCookie: a plain preference cookie, read again by the server
    document.cookie = `${LANG_COOKIE}=${next}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    document.documentElement.lang = next;
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

/** The current language and its setter. */
export function useLang(): LangState {
  return useContext(LangContext);
}

/** The texts of the current language. */
export function useT(): Messages {
  return messages[useContext(LangContext).lang];
}

/** Picks the viewer's language from a text the server sent in both languages. */
export function useLocalize(): (text: string | null | undefined) => string {
  const { lang } = useContext(LangContext);
  return useCallback((text) => localizeIn(text, lang) ?? "", [lang]);
}
