import { type Lang, langOf } from "@namarr/core/i18n";
import { LANG_COOKIE } from "~/lib/i18n";

const SAVED = new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=(de|en)(?:;|$)`);

/** The saved choice (cookie), else the browser's first language; English when neither is German. */
export function uiLangFrom(headers: Headers): Lang {
  const saved = SAVED.exec(headers.get("cookie") ?? "")?.[1] as Lang | undefined;
  return saved ?? langOf(headers.get("accept-language"));
}
