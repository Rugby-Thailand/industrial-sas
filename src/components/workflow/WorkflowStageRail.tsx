"use client";

import { ArrowRight, Check, CircleAlert } from "lucide-react";
import { useLocale } from "next-intl";
import type { ReactNode } from "react";

export type WorkflowStage = {
  readonly label: string;
  readonly href?: string;
};

export function WorkflowStageRail({
  eyebrow,
  title,
  detail,
  stages,
  currentStage,
  nextAction,
  secondaryAction,
  signal,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
  readonly stages: readonly WorkflowStage[];
  readonly currentStage: number;
  readonly nextAction: {
    readonly label: string;
    readonly title: string;
    readonly detail: string;
    readonly action: ReactNode;
  };
  readonly secondaryAction?: ReactNode;
  readonly signal?: {
    readonly label: string;
    readonly tone: "attention" | "clear";
  };
}) {
  const locale = useLocale();

  return (
    <section className="overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-sm">
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)] lg:p-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-bold tracking-[0.16em] text-accent uppercase">
              {eyebrow}
            </p>
            {signal === undefined ? null : (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
                  signal.tone === "clear"
                    ? "bg-success-surface text-success"
                    : "bg-warning-surface text-warning"
                }`}
              >
                {signal.tone === "attention" ? (
                  <CircleAlert aria-hidden="true" className="size-3.5" />
                ) : (
                  <Check aria-hidden="true" className="size-3.5" />
                )}
                {signal.label}
              </span>
            )}
          </div>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-text">
            {title}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            {detail}
          </p>

          <nav aria-label={eyebrow} className="mt-5 overflow-x-auto pb-1">
            <ol className="flex min-w-max items-start">
              {stages.map((stage, index) => {
                const complete = index < currentStage;
                const active = index === currentStage;
                const marker = (
                  <span
                    aria-hidden="true"
                    className={`grid size-8 shrink-0 place-items-center rounded-full border-2 text-xs font-black ${
                      complete
                        ? "border-success bg-success text-background"
                        : active
                          ? "border-accent bg-accent text-accent-contrast"
                          : "border-border-strong bg-raised text-muted"
                    }`}
                  >
                    {complete ? <Check className="size-4" /> : index + 1}
                  </span>
                );
                const label = (
                  <span
                    className={`mt-2 block text-xs font-bold ${active ? "text-accent" : complete ? "text-text" : "text-muted"}`}
                  >
                    {stage.label}
                  </span>
                );

                return (
                  <li
                    key={`${index}-${stage.label}`}
                    className="relative w-28 shrink-0 pr-4 last:w-24 last:pr-0"
                    aria-current={active ? "step" : undefined}
                  >
                    {index === stages.length - 1 ? null : (
                      <span
                        aria-hidden="true"
                        className={`absolute top-4 left-8 h-0.5 w-20 ${complete ? "bg-success" : "bg-border-strong"}`}
                      />
                    )}
                    {stage.href === undefined ? (
                      <div className="relative">
                        {marker}
                        {label}
                      </div>
                    ) : (
                      <a
                        href={`/${locale}${stage.href}`}
                        className="relative block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                      >
                        {marker}
                        {label}
                      </a>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>

        <aside className="rounded-xl border border-accent/40 bg-accent/5 p-4">
          <p className="text-xs font-bold tracking-wide text-accent uppercase">
            {nextAction.label}
          </p>
          <h3 className="mt-2 text-lg font-black text-text">
            {nextAction.title}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {nextAction.detail}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {nextAction.action}
            {secondaryAction}
          </div>
        </aside>
      </div>
    </section>
  );
}

export function NextActionLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  const locale = useLocale();

  return (
    <a
      href={`/${locale}${href}`}
      className="inline-flex min-h-touch items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-contrast hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {children}
      <ArrowRight aria-hidden="true" className="size-4" />
    </a>
  );
}
