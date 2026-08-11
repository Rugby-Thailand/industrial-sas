/**
 * Per-request i18n configuration for the server.
 *
 * `requestLocale` is the `[locale]` segment the router matched. It is narrowed
 * with `hasLocale` before it is used, because a segment is a URL and a URL is
 * untrusted: `/xx/dashboard` must render Thai, not throw and not invent a
 * catalogue.
 *
 * The timezone is pinned to the organization default (`D-05`) rather than left
 * to the runtime. Without it, `next-intl` formats instants in the server's zone,
 * which differs between a developer laptop, CI, and a deployment — and a
 * timestamp that changes by host is the exact class of defect `ADR-0010` §6
 * exists to prevent. A per-organization override lands with the organization
 * settings read, which needs a resolved tenant this layer does not have.
 */
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { messagesFor } from "./messages";
import { DEFAULT_TIME_ZONE, routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: messagesFor(locale),
    timeZone: DEFAULT_TIME_ZONE,
  };
});
