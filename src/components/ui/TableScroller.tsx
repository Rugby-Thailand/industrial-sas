"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export function TableScroller({
  label,
  testId,
  children,
}: {
  readonly label: string;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  const t = useTranslations("Table");

  return (
    <div
      className="@container/table overflow-hidden rounded-lg border border-border bg-surface"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="overflow-x-auto"
      >
        {children}
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-muted @2xl/table:hidden">
        {t("scrollHint")}
      </p>
    </div>
  );
}
