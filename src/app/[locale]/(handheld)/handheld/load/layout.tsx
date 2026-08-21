import type { ReactNode } from "react";
import { RouteMessages } from "@/i18n/RouteMessages";
export default async function HandheldLoadLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <RouteMessages scope="(handheld)/handheld/load" locale={locale}>
      {children}
    </RouteMessages>
  );
}
