import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Link } from "@/i18n/navigation";
import { HANDHELD_TASKS } from "@/lib/navigation";

/**
 * The handheld task launcher.
 *
 * A launcher, not a small dashboard (UX plan §3): an operator arriving at a
 * handheld is starting a task, and a screen of figures is one more thing between
 * them and the scan.
 *
 * The four unbuilt tasks are listed and marked unavailable rather than hidden.
 * An operator trained on the inbound slice who finds Receive missing needs to be
 * able to tell "not built" from "not permitted" — the second is a supervisor
 * conversation, the first is not. They are rendered as list items with a badge
 * rather than as disabled links, because a disabled link is unfocusable and
 * therefore invisible to a scanner-driven keyboard pass.
 */
export default async function HandheldHomePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Handheld");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ul className="flex flex-col gap-3">
        {HANDHELD_TASKS.map((task) => (
          <li key={task.labelKey}>
            {task.available && task.href !== undefined ? (
              <Link
                href={task.href}
                className="flex min-h-touch items-center rounded-lg border-2 border-border-strong bg-surface px-4 py-3 text-lg font-semibold text-text"
              >
                {t(task.labelKey)}
              </Link>
            ) : (
              <div className="flex min-h-touch flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
                <span className="text-lg font-semibold text-disabled">
                  {t(task.labelKey)}
                </span>
                <StatusBadge
                  tone="muted"
                  label={t("taskUnavailable")}
                  title={t("notBuiltYet")}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
