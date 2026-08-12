import type { ReactNode } from "react";

import { RouteMessages } from "@/i18n/RouteMessages";

/** Client messages used only by the cross-workflow inbound control board. */
export default async function InboundLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <RouteMessages scope="(desktop)/inbound" locale={locale}>
      {children}
    </RouteMessages>
  );
}
