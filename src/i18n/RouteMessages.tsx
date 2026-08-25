import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import {
  pickMessages,
  ROUTE_NAMESPACES,
  type RouteMessageScope,
} from "./clientMessages";

export interface RouteMessagesLayoutProps {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}

type RouteMessagesProps = {
  readonly scope: RouteMessageScope;
  readonly children: ReactNode;
} & (
  | {
      readonly params: Promise<{ locale: string }>;
      readonly locale?: never;
    }
  | {
      readonly locale: string;
      readonly params?: never;
    }
);

export async function RouteMessages(props: RouteMessagesProps) {
  const { scope, children } = props;
  const locale =
    props.locale === undefined ? (await props.params).locale : props.locale;
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
