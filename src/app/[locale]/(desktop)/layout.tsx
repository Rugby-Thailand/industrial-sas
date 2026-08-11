import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import { DesktopShell } from "@/components/shell/DesktopShell";

/**
 * The supervisor route group.
 *
 * A route group rather than a device check (UX plan §7): which shell an operator
 * is in is a property of the route they chose, never of the width of the screen
 * they happen to be holding. A supervisor on a tablet gets this shell; an
 * operator who opens `/handheld` gets the other one on a 27-inch monitor.
 */
export default async function DesktopLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <DesktopShell>{children}</DesktopShell>;
}
