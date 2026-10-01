import type { Lang } from "@namarr/core/i18n";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { uiLangFrom } from "~/server/lang.server";

/** The language for the first render. No login needed: the login page is translated too. */
export const getUiLang = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ lang: Lang }> => ({
    lang: uiLangFrom(getRequest().headers),
  }),
);
