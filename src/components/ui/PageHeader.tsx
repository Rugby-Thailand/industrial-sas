"use client";

/**
 * The single `<h1>` of a screen, with its explanation on demand.
 *
 * Centralised so that every route has exactly one top-level heading and the
 * heading order below it starts at `<h2>`. Skipped levels are one of the most
 * common axe findings and the easiest to reintroduce screen by screen.
 *
 * The description no longer occupies permanent vertical space: on a warehouse
 * screen the operator reads it once during training and then scrolls past it
 * every shift. It sits behind an icon-led disclosure instead — a touch-sized
 * `aria-expanded` toggle beside the title — so the help is one tap away without
 * costing the first row of every list its place above the fold, which matters
 * most on the handheld.
 */
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

export function PageHeader({
  title,
  description,
}: {
  readonly title: string;
  readonly description?: string;
}) {
  const t = useTranslations("App");
  const helpId = useId();
  const [showHelp, setShowHelp] = useState(false);

  return (
    <header className="mb-4">
      <div className="flex min-w-0 items-center gap-1">
        <h1 className="text-xl font-bold tracking-tight text-text sm:text-2xl">
          {title}
        </h1>
        {description === undefined ? null : (
          <button
            type="button"
            aria-expanded={showHelp}
            aria-controls={helpId}
            title={t("aboutPage")}
            onClick={() => setShowHelp((open) => !open)}
            className="flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-md text-muted outline-none hover:text-text focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Info aria-hidden="true" className="size-4" />
            <span className="sr-only">{t("aboutPage")}</span>
          </button>
        )}
      </div>
      {description !== undefined && showHelp ? (
        <p
          id={helpId}
          className="mt-0.5 max-w-prose text-sm leading-relaxed text-muted"
        >
          {description}
        </p>
      ) : null}
    </header>
  );
}
