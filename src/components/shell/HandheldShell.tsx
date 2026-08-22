"use client";

/**
 * The operator shell: one task per screen, a compact header, nothing else
 * competing for attention.
 *
 * The header carries only what an operator has to be able to check without
 * leaving the task — the warehouse they are acting in and their account. There
 * is no sidebar and no section tree: the task
 * launcher *is* the navigation, and a nav rail on a 360-pixel screen would cost
 * a quarter of the width the work needs.
 *
 * Body text starts at 16 pixels and every control clears 48×48 (`INV-0010-06`).
 * The back link is a control, so it is a full-height row rather than a small
 * chevron.
 *
 * ### Why the shell is bounded rather than full-bleed
 *
 * On a 1280px desktop the same markup stretched a one-task screen across the
 * whole window: a single field with a metre of empty space beside it, and a
 * footer link the width of the display. This shell is a *handheld* shell — it is
 * opened on a scanner, and on a desktop it is opened to check what an operator
 * sees. So the column is capped and centred, which is what a handheld workspace
 * looks like on a large screen.
 *
 * The cap is above every phone width this application targets, so nothing
 * changes at 360px: `max-w-md` is 448 CSS pixels, and the column simply fills a
 * narrow viewport as it did before.
 */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/navigation";

import { LocaleSwitcher } from "./LocaleSwitcher";
import { AccountButton } from "./AccountButton";
import { WorkspaceContextBar } from "./WorkspaceContextBar";

const MAIN_ID = "handheld-content";

export function HandheldShell({ children }: { readonly children: ReactNode }) {
  const t = useTranslations("Navigation");

  return (
    <div
      data-testid="handheld-workspace"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-canvas text-base text-text sm:border-x sm:border-border"
    >
      <a
        href={`#${MAIN_ID}`}
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-accent focus:px-4 focus:py-3 focus:text-accent-contrast"
      >
        {t("skipToContent")}
      </a>

      <header className="border-b border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LocaleSwitcher />
          <AccountButton />
        </div>
        <div className="mt-3">
          <WorkspaceContextBar />
        </div>
      </header>

      <main id={MAIN_ID} className="flex-1 p-4">
        {children}
      </main>

      <footer className="border-t border-border bg-surface p-3">
        <Link
          href={ROUTES.dashboard}
          className="flex min-h-touch items-center justify-center rounded-md border border-border-strong px-4 font-medium text-text"
        >
          {t("backToDesktop")}
        </Link>
      </footer>
    </div>
  );
}
