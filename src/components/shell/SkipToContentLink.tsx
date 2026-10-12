"use client";

import type { ReactNode } from "react";

/**
 * Move focus to the main landmark without writing a native fragment entry.
 * Next ignores state-less history entries on Back, which would leave the route
 * loader over the previous page. The href keeps link semantics and a no-script
 * fallback.
 */
export function SkipToContentLink({
  targetId,
  children,
}: {
  readonly targetId: string;
  readonly children: ReactNode;
}) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
      onClick={(event) => {
        const target = document.getElementById(targetId);
        if (!target) return;
        event.preventDefault();
        target.focus();
      }}
    >
      {children}
    </a>
  );
}
