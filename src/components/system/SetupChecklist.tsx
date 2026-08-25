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
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li
            key={row.key}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge
                tone={row.ready ? "success" : "warning"}
                label={row.title}
              />
            </div>
            {row.body === undefined ? null : (
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {row.body}
              </p>
            )}
          </li>
        ))}
      </ul>
      {hasMissingDependency ? (
        <>
          <p className="text-sm text-muted">{t("envHint")}</p>
          <p className="rounded-lg border border-border-strong bg-surface p-4 text-sm leading-relaxed text-text">
            {t("noFakeAuth")}
          </p>
        </>
      ) : null}
    </section>
  );
}
