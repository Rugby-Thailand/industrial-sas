import type { ReactNode } from "react";

import { RouteMessages } from "@/i18n/RouteMessages";

export default async function DevicesLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <RouteMessages scope="(desktop)/devices" locale={locale}>
      {children}
    </RouteMessages>
  );
}
