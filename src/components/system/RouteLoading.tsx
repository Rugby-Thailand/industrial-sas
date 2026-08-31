"use client";

import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";

export function RouteLoading() {
  const t = useTranslations("Navigation");

  return (
    <section
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="flex flex-col gap-6"
    >
      <span className="sr-only">{t("loadingPage")}</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full max-w-72" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div
        aria-hidden="true"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full sm:col-span-2 xl:col-span-1" />
      </div>
      <div aria-hidden="true" className="rounded-lg border border-border p-4">
        <Skeleton className="h-6 w-full max-w-48" />
        <div className="mt-5 flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      </div>
    </section>
  );
}
