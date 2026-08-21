import type { ReactNode } from "react";

import { RouteMessages } from "@/i18n/RouteMessages";

/** The client message scope for the device registry. See the sibling layouts. */
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
