import { readFileSync } from "node:fs";
import { type Lang, localize } from "../src/i18n.ts";

const load = (lang: Lang) =>
  JSON.parse(readFileSync(new URL(`../../../apps/server/messages/${lang}.json`, import.meta.url), "utf8")) as Record<string, unknown>;
const messages = { de: load("de"), en: load("en") };

/** localize() with the texts of apps/server/messages, for tests of the packages (plain messages). */
export function text(value: string, lang: Lang): string {
  return localize(value, lang, (key, inputs) => {
    const message = messages[lang][key];
    if (typeof message !== "string") return undefined;
    return message.replace(/(?<!\\)\{(\w+)\}/g, (_, name: string) => String(inputs[name] ?? "")).replace(/\\([{}])/g, "$1");
  });
}
