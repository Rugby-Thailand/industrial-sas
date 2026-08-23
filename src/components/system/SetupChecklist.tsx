"use client";

/**
 * What is configured, what is not, and what to do about it.
 *
 * This is the honest gate `ADR-0001` implies. Identity is Clerk's and
 * authorization is Convex's; with neither configured the application cannot
 * resolve a tenant, and the useful thing to show is *which* dependency is
 * missing rather than a generic error. Each row is a fact about this machine,
 * derived from the same `resolveAppEnvironment` every other screen uses, so the
 * checklist and the panels can never disagree.
 *
 * The last line is the one that matters most, and it is deliberately a claim
 * about the codebase rather than an instruction: there is no bypass. Someone
 * reading this screen while trying to see data is exactly the person who would
 * otherwise go looking for a development shortcut, and the answer is that
 * hand-configuring one would put an unverified token in front of
 * `resolveTenantContext`.
 *
 * The checklist does **not** open with `Setup.intro`. Both screens that mount it
 * already introduce it in their own words — the setup page in its header and
 * the sign-in page in the notice that says why sign-in is unavailable. The host
 * is the only place that knows whether that context has already been stated.
 *
 * A configured row is confirmation, not a remediation target. Its missing-state
 * instructions are therefore omitted, as are the environment and authentication
 * notes when the whole deployment is ready.
 */
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
