"use client";

import type { ComponentProps } from "react";
import { Link } from "@/i18n/navigation";

/** Warm visible destinations, including their page code, before a menu tap.
 * Default prefetch stops at the desktop loading boundary on dynamic routes.
 * Waiting for hover leaves fast clicks and touch navigation on the cold path.
 */
export function SidebarNavigationLink({
  prefetch = true,
  ...props
}: ComponentProps<typeof Link>) {
  return <Link {...props} prefetch={prefetch} />;
}
