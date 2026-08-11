"use client";

/**
 * The supervisor shell: persistent navigation, permanent context chrome, dense
 * content.
 *
 * ### One navigation tree, one DOM node
 *
 * The compact and wide layouts render the *same* `<nav>`, toggled by a
 * disclosure button that is itself hidden above the breakpoint. Rendering two
 * copies — one `lg:hidden`, one `hidden lg:block` — is the usual shortcut and it
 * produces two navigation landmarks, duplicate link text for a screen reader,
 * and two elements competing to be "the active page". One node with a
 * `aria-expanded` button avoids all three.
 *
 * The disclosure state is *not* device detection. The UX plan (§7) is explicit
 * that viewport sniffing must never move an operator into a different workflow:
 * this is the same shell at every width, and the handheld shell is a different
 * route the operator chooses.
 *
 * ### Skip link
 *
 * First focusable element on the page, visible when focused, targeting the main
 * region. With a scanner acting as a keyboard, tabbing past a nav on every screen
 * is a real cost (`INV-0010-08`).
 */
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { ConnectionIndicator } from "@/components/system/ConnectionIndicator";
import { PreviewBanner } from "@/components/system/PreviewBanner";
import { Link, usePathname } from "@/i18n/navigation";
import { DESKTOP_NAVIGATION, isActivePath } from "@/lib/navigation";

import { LocaleSwitcher } from "./LocaleSwitcher";
import { WorkspaceContextBar } from "./WorkspaceContextBar";

const MAIN_ID = "main-content";
const NAV_ID = "primary-navigation";

export function DesktopShell({ children }: { readonly children: ReactNode }) {
  const t = useTranslations("Navigation");
  const appT = useTranslations("App");
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-text">
      <a
        href={`#${MAIN_ID}`}
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-accent focus:px-4 focus:py-3 focus:text-accent-contrast"
      >
        {t("skipToContent")}
      </a>

      <PreviewBanner />

      <header className="border-b border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="min-h-touch min-w-touch rounded-md border border-border-strong px-3 lg:hidden"
              aria-expanded={navOpen}
              aria-controls={NAV_ID}
              onClick={() => setNavOpen((open) => !open)}
            >
              {navOpen ? t("closeMenu") : t("openMenu")}
            </button>
            <span className="text-base font-bold tracking-tight">
              {appT("name")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <ConnectionIndicator />
            <LocaleSwitcher />
          </div>
        </div>
        <div className="border-t border-border px-4 py-3">
          <WorkspaceContextBar />
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <nav
          id={NAV_ID}
          aria-label={t("primary")}
          className={`${navOpen ? "block" : "hidden"} border-b border-border bg-surface p-3 lg:block lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0`}
        >
          {DESKTOP_NAVIGATION.map((section) => (
            <div key={section.labelKey} className="mb-4 last:mb-0">
              <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                {t(section.labelKey)}
              </p>
              <ul>
                {section.items.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setNavOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-touch items-center rounded-md px-3 text-sm font-medium ${
                          active
                            ? "border-l-4 border-accent bg-raised font-semibold text-accent"
                            : "text-text hover:bg-raised"
                        }`}
                      >
                        {t(item.labelKey)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <main id={MAIN_ID} className="flex-1 p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
