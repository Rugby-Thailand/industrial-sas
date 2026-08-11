/**
 * Locale routing configuration — the single declaration of which locales exist.
 *
 * Thai is the default and English is the fallback (`D-06`, `ADR-0010` §1). The
 * prefix is `always`, so `/` never serves content: every rendered URL names its
 * locale, which is what makes `INV-0010-05` ("locale is resolved from the URL
 * segment … server-side") observable rather than implicit. A prefix-less default
 * would leave the Thai screens indistinguishable from an unresolved locale in
 * logs, tests, and shared links.
 *
 * `localeDetection` is on so a first visit is negotiated from `Accept-Language`
 * and thereafter from the locale cookie `next-intl` sets — the "user preference"
 * half of `INV-0010-05`. Negotiation only ever picks one of the locales below;
 * an unknown `Accept-Language` falls back to Thai, never to English.
 */
import { defineRouting } from "next-intl/routing";

/** Every locale the application serves. Thai first, deliberately. */
export const LOCALES = ["th", "en"] as const;

export type AppLocale = (typeof LOCALES)[number];

/** Thai is the product default; English is the fallback (`D-06`). */
export const DEFAULT_LOCALE: AppLocale = "th";

/**
 * The organization timezone default (`D-05`).
 *
 * Formatting of an *instant* has to pick a zone, and picking the server's would
 * make a Bangkok receiving shift render differently depending on where the
 * process runs. Business dates are computed by `convex/model/time/businessDate.ts`
 * from the same default; this constant is the presentation-layer half of it.
 */
export const DEFAULT_TIME_ZONE = "Asia/Bangkok";

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
  localeDetection: true,
});
