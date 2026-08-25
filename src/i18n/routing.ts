import { defineRouting } from "next-intl/routing";

/** Every locale the application serves. Thai first, deliberately. */
export const LOCALES = ["th", "en"] as const;

export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "th";

export const DEFAULT_TIME_ZONE = "Asia/Bangkok";

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
  localeDetection: true,
});
