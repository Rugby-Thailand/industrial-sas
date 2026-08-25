import en from "../../messages/en.json";
import th from "../../messages/th.json";

import { DEFAULT_LOCALE, type AppLocale } from "./routing";

export type MessageCatalogue = typeof th;

const CATALOGUES: Readonly<Record<AppLocale, MessageCatalogue>> = Object.freeze(
  {
    th,

    en: en satisfies MessageCatalogue,
  },
);

export function messagesFor(locale: string): MessageCatalogue {
  return CATALOGUES[locale as AppLocale] ?? CATALOGUES[DEFAULT_LOCALE];
}

export const ALL_CATALOGUES = CATALOGUES;
