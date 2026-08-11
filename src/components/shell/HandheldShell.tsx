"use client";

/**
 * The operator shell: one task per screen, a compact header, nothing else
 * competing for attention.
 *
 * The header carries only what an operator has to be able to check without
 * leaving the task — the warehouse they are acting in and whether the server is
 * answering (UX plan §3). There is no sidebar and no section tree: the task
 * launcher *is* the navigation, and a nav rail on a 360-pixel screen would cost
 * a quarter of the width the work needs.
 *
 * Body text starts at 16 pixels and every control clears 48×48 (`INV-0010-06`).
 * The back link is a control, so it is a full-height row rather than a small
 * chevron.
 */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { ConnectionIndicator } from "@/components/system/ConnectionIndicator";
import { PreviewBanner } from "@/components/system/PreviewBanner";
import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/navigation";

import { LocaleSwitcher } from "./LocaleSwitcher";
import { WorkspaceContextBar } from "./WorkspaceContextBar";

const MAIN_ID = "handheld-content";

export function HandheldShell({ children }: { readonly children: ReactNode }) {
  const t = useTranslations("Navigation");

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-base text-text">
      <a
        href={`#${MAIN_ID}`}
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-accent focus:px-4 focus:py-3 focus:text-accent-contrast"
      >
        {t("skipToContent")}
      </a>

      <PreviewBanner />

      <header className="border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <ConnectionIndicator />
          <LocaleSwitcher />
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
