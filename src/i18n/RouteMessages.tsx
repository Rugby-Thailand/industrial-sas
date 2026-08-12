import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import {
  pickMessages,
  ROUTE_NAMESPACES,
  type RouteMessageScope,
} from "./clientMessages";

/**
 * The message provider for one route subtree.
 *
 * Mounted by a `layout.tsx` inside the subtree, so the namespaces a screen needs
 * are paid for by that screen and by nothing else. See `clientMessages.ts` for
 * why the sets are what they are and why a route entry cannot rely on the shell
 * provider above it.
 *
 * Only `messages` is passed. `locale`, `timeZone`, `formats`, and `now` are
 * filled in by `next-intl`'s server wrapper from the request configuration and
 * then inherited by the nested provider, so a route layout has no opportunity to
 * disagree with the root about which language or zone it is rendering in.
 *
 * `setRequestLocale` is repeated here for the same reason the group layouts
 * repeat it: reading messages without it opts the subtree into dynamic
 * rendering, and every route in this application is prerendered.
 */
export async function RouteMessages({
  scope,
  locale,
  children,
}: {
  readonly scope: RouteMessageScope;
  readonly locale: string;
  readonly children: ReactNode;
}) {
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider
      messages={pickMessages(messages, ROUTE_NAMESPACES[scope])}
    >
      {children}
    </NextIntlClientProvider>
  );
}
