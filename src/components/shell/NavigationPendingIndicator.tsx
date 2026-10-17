"use client";

import { useLinkStatus } from "next/link";
import { Spinner } from "@/components/ui/spinner";

export function NavigationPendingIndicator() {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-hidden="true"
      data-pending={pending}
      data-slot="navigation-pending-indicator"
      className="navigation-pending-indicator pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2"
    >
      <Spinner aria-hidden="true" />
    </span>
  );
}
