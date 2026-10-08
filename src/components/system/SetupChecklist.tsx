"use client";

import { useTranslations } from "next-intl";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { StatusBadge } from "@/components/ui/StatusBadge";

export function SetupChecklist() {
  const t = useTranslations("Setup");
  const environment = useAppEnvironment();

  const rows = [
    {
      key: "convex",
      ready: environment.backendConfigured,
      title: environment.backendConfigured
        ? t("convexReady")
        : t("convexTitle"),
      body: environment.backendConfigured ? undefined : t("convexBody"),
    },
    {
      key: "identity",
      ready: environment.identityConfigured,
      title: environment.identityConfigured
        ? t("identityReady")
        : t("identityTitle"),
      body: environment.identityConfigured ? undefined : t("identityBody"),
    },
  ] as const;
  const hasMissingDependency = rows.some((row) => !row.ready);

  return (
    <section className="flex flex-col gap-4">
      <ul className="divide-y divide-border border-y border-border">
        {rows.map((row) => (
          <li key={row.key} className="py-3">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge
                tone={row.ready ? "success" : "warning"}
                label={row.title}
              />
            </div>
            {row.body === undefined ? null : (
              <details className="mt-1 text-sm text-muted">
                <summary className="flex min-h-11 cursor-pointer items-center">
                  {t("technicalDetails")}
                </summary>
                <p className="pb-2 leading-relaxed">{row.body}</p>
              </details>
            )}
          </li>
        ))}
      </ul>
      {hasMissingDependency ? (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
            {t("technicalDetails")}
          </summary>
          <p className="text-sm text-muted">{t("envHint")}</p>
          <p className="mt-3 text-sm leading-relaxed text-text">
            {t("noFakeAuth")}
          </p>
        </details>
      ) : null}
    </section>
  );
}
