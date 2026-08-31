"use client";

import { useLinkStatus } from "next/link";

export function NavigationPendingIndicator() {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-hidden="true"
      data-pending={pending}
      data-slot="navigation-pending-indicator"
      className="navigation-pending-indicator absolute top-1/2 right-2 size-2 -translate-y-1/2 rounded-full bg-current"
    />
  );
}
