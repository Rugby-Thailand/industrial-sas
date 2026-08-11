import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import { HandheldShell } from "@/components/shell/HandheldShell";

/** The operator route group. See the desktop layout for why this is a route. */
export default async function HandheldLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HandheldShell>{children}</HandheldShell>;
}
