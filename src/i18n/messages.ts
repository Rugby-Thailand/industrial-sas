/**
 * Message catalogue loading, in one place, for every consumer.
 *
 * Both catalogues are imported statically rather than through a dynamic
 * `import(\`../../messages/${locale}.json\`)`. A template specifier defers the
 * "does this file exist" question to run time and to the bundler's glob, so a
 * renamed catalogue becomes a 500 on a warehouse screen instead of a build
 * failure. There are two locales and they are both small; there is nothing to
 * gain by loading them lazily.
 *
 * The Thai catalogue is the type source. `MessageCatalogue` is `typeof th`, so a
 * key present in English and absent in Thai is a type error at every call site
 * that uses it — the compile-time half of `INV-0010-02`. The run-time half (key
 * parity in both directions, no empty strings) is `messages.test.ts`.
 */
import en from "../../messages/en.json";
import th from "../../messages/th.json";

import { DEFAULT_LOCALE, type AppLocale } from "./routing";

/**
 * The shape every catalogue must have, taken from the Thai one.
 *
 * Thai rather than English on purpose: this is a Thai-first product, and the
 * catalogue that defines the key set should be the one an operator reads.
 */
export type MessageCatalogue = typeof th;

const CATALOGUES: Readonly<Record<AppLocale, MessageCatalogue>> = Object.freeze(
  {
    th,
    // The English catalogue is checked against the Thai shape here rather than at
    // its own import, so a drifted key is reported on this line with both files
    // named, instead of somewhere downstream.
    en: en satisfies MessageCatalogue,
  },
);

/**
 * The catalogue for a locale, falling back to Thai.
 *
 * The fallback exists because the locale reaching this function comes from a URL
 * segment, and a segment is user input until something narrows it. `hasLocale`
 * does that narrowing in `request.ts`; this is the second line of defence, and it
 * falls back to the *default* locale rather than to English, because "Thai is the
 * default, English is the fallback" (`D-06`) describes content authorship, not
 * failure handling.
 */
export function messagesFor(locale: string): MessageCatalogue {
  return CATALOGUES[locale as AppLocale] ?? CATALOGUES[DEFAULT_LOCALE];
}

/** Every loaded catalogue, keyed by locale. Used by the parity test. */
export const ALL_CATALOGUES = CATALOGUES;
