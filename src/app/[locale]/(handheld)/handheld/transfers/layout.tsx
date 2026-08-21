import type { ReactNode } from "react";

import { RouteMessages } from "@/i18n/RouteMessages";

export default async function HandheldTransfersLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <RouteMessages scope="(handheld)/handheld/transfers" locale={locale}>
      {children}
    </RouteMessages>
  );
}
