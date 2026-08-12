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
 * The checklist does **not** open with `Setup.intro`. Each of the three screens
 * that mount it already introduces it in its own words — the setup page in its
 * header, the dashboard above its system-state section, the sign-in page in the
 * notice that says why sign-in is unavailable — so rendering the sentence here
 * as well printed it twice on the same screen. The context is necessary; the
 * repetition was not, and the host is the only place that knows whether it has
 * been said already.
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
      body: t("convexBody"),
    },
    {
      key: "identity",
      ready: environment.identityConfigured,
      title: environment.identityConfigured
        ? t("identityReady")
        : t("identityTitle"),
      body: t("identityBody"),
    },
  ] as const;

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
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {row.body}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">{t("envHint")}</p>
      <p className="rounded-lg border border-border-strong bg-surface p-4 text-sm leading-relaxed text-text">
        {t("noFakeAuth")}
      </p>
    </section>
  );
}
