"use client";

import { CloudOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { useConnectionStall } from "@/components/system/connectionStall";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

export function RouteLoading() {
  const t = useTranslations("Navigation");
  const app = useTranslations("App");
  // While the shell says the server can't be reached, the page waits without
  // motion and leaves the announcement to that notice (see LedgerPanelStatus).
  const waiting = useConnectionStall() !== null;

  return (
    <section
      key={waiting ? "waiting" : "loading"}
      {...(waiting
        ? { "data-waiting": "connection" }
        : {
            role: "status",
            "aria-label": t("loadingPage"),
            "aria-busy": "true",
            "aria-live": "polite",
          })}
      data-testid="route-loading"
      className="flex flex-col gap-6"
    >
      <div className="flex min-h-touch items-center gap-2 text-sm text-muted">
        {waiting ? (
          <CloudOff aria-hidden="true" className="size-4 shrink-0" />
        ) : (
          <Spinner aria-hidden="true" />
        )}
        <span>{waiting ? app("dataPending") : t("loadingPage")}</span>
      </div>
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
