import { AsyncLocalStorage } from "node:async_hooks";
import { type Lang, langOf } from "@namarr/core/i18n";
import { LANG_COOKIE, setLangResolver } from "~/lib/i18n";

const SAVED = new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=(de|en)(?:;|$)`);

/** The saved choice (cookie), else the browser's first language; English when neither is German. */
export function uiLangFrom(headers: Headers): Lang {
  const saved = SAVED.exec(headers.get("cookie") ?? "")?.[1] as Lang | undefined;
  return saved ?? langOf(headers.get("accept-language"));
}

// One store per process, however often bundling loads this module.
const g = globalThis as unknown as { __namarrLangStore?: AsyncLocalStorage<Lang> };
g.__namarrLangStore ??= new AsyncLocalStorage<Lang>();
const store = g.__namarrLangStore;
setLangResolver(() => store.getStore());

/** Runs a request in its viewer's language: server rendering and m.*() answer in it. */
export function withRequestLang<T>(headers: Headers, fn: () => T): T {
  return store.run(uiLangFrom(headers), fn);
}
