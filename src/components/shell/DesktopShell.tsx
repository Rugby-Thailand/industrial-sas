"use client";

/**
 * The supervisor shell: persistent navigation, permanent context chrome, dense
 * content.
 *
 * ### One navigation tree, one DOM node
 *
 * Built on the shadcn Sidebar primitives, and on the half of that structure this
 * shell can actually use. Above the `lg` breakpoint the tree is an in-flow rail
 * beside the content; below it, the *same* tree moves into a Sheet — one at a
 * time, never both. That distinction is the whole reason the structure is safe
 * to adopt: rendering two copies, one `lg:hidden` and one `hidden lg:block`, is
 * the usual shortcut and it produces two navigation landmarks, duplicate link
 * text for a screen reader, and two elements competing to be "the active page".
 * The links come from one `DESKTOP_NAVIGATION` and the active route is computed
 * once, in `NavigationTree` below.
 *
 * The registry's own desktop branch is `fixed inset-y-0 h-svh`, an app-shell
 * rail that owns the full viewport height. This shell's header is not decoration
 * — the preview banner, the connection state, and the organization/warehouse
 * context all live above the fold and must not be overlapped — so the rail is
 * rendered in flow with `collapsible="none"` and the sheet is composed
 * explicitly. Everything else is the registry's: the provider, the content,
 * group, menu, and menu-button parts, and the Sheet the mobile branch uses.
 *
 * The disclosure state is *not* device detection. The UX plan (§7) is explicit
 * that viewport sniffing must never move an operator into a different workflow:
 * this is the same shell, the same links, and the same active route at every
 * width, and only the container they sit in changes. The handheld shell is a
 * different route the operator chooses.
 *
 * The rail does not collapse on desktop. shadcn ships a collapse toggle and a
 * `Ctrl`/`Cmd`+`B` accelerator; the accelerator was removed from the vendored
 * primitive because a HID scanner types into the document, and the toggle is not
 * offered because a supervisor screen has room for the rail and a nav that can
 * disappear is a nav somebody loses. The one trigger this shell renders is the
 * `lg:hidden` sheet opener, which is exactly what the shell had before.
 *
 * ### Skip link
 *
 * First focusable element on the page, visible when focused, targeting the main
 * region. With a scanner acting as a keyboard, tabbing past a nav on every screen
 * is a real cost (`INV-0010-08`).
 */
import { useTranslations } from "next-intl";
import { Menu, X } from "lucide-react";
import { type ReactNode } from "react";

import { ConnectionIndicator } from "@/components/system/ConnectionIndicator";
import { PreviewBanner } from "@/components/system/PreviewBanner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { Link, usePathname } from "@/i18n/navigation";
import { DESKTOP_NAVIGATION, isActivePath } from "@/lib/navigation";

import { LocaleSwitcher } from "./LocaleSwitcher";
import { WorkspaceContextBar } from "./WorkspaceContextBar";

const MAIN_ID = "main-content";
const NAV_ID = "primary-navigation";

export function DesktopShell({ children }: { readonly children: ReactNode }) {
  const t = useTranslations("Navigation");

  return (
    <SidebarProvider className="min-h-dvh flex-col bg-canvas text-text">
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
            <NavigationDisclosure />
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

      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        <NavigationRegion />

        <main id={MAIN_ID} className="min-w-0 flex-1 p-4 lg:p-6">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}

/**
 * The one control that opens and closes the compact navigation.
 *
 * Bound to `openMobile` explicitly rather than through the registry's
 * `toggleSidebar`, which branches on viewport width. The desktop rail is not
 * collapsible here, so a single meaning for "expanded" is the honest one: the
 * sheet is open or it is not. The visible control is the conventional
 * hamburger/close icon so it stays compact; its localized accessible name
 * still says the action in full.
 * `aria-controls` is dropped while the tree is absent from the document rather
 * than left pointing at an id nothing has.
 */
function NavigationDisclosure() {
  const t = useTranslations("Navigation");
  const { openMobile, setOpenMobile, isMobile } = useSidebar();
  const present = !isMobile || openMobile;

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="lg:hidden"
      aria-label={openMobile ? t("closeMenu") : t("openMenu")}
      aria-expanded={openMobile}
      {...(present ? { "aria-controls": NAV_ID } : {})}
      onClick={() => setOpenMobile(!openMobile)}
    >
      {openMobile ? (
        <X aria-hidden="true" className="size-6" />
      ) : (
        <Menu aria-hidden="true" className="size-6" />
      )}
    </Button>
  );
}

/** The rail, or the sheet holding the same rail. Never both. */
function NavigationRegion() {
  const t = useTranslations("Navigation");
  const { isMobile, openMobile, setOpenMobile } = useSidebar();

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          side="left"
          closeLabel={t("closeMenu")}
          className="gap-0 p-0 data-[side=left]:w-64 data-[side=left]:sm:max-w-64"
        >
          {/*
           * Radix requires a title on a dialog. The sheet's own heading is
           * visually redundant next to the navigation landmark it contains, so
           * it is the accessible name only.
           */}
          <SheetHeader className="sr-only">
            <SheetTitle>{t("primary")}</SheetTitle>
          </SheetHeader>
          <Sidebar collapsible="none" className="h-full w-full">
            <div
              aria-hidden="true"
              className="h-12 shrink-0 border-b border-sidebar-border"
            />
            <NavigationTree onNavigate={() => setOpenMobile(false)} />
          </Sidebar>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sidebar
      collapsible="none"
      className="w-full border-b border-border lg:w-56 lg:shrink-0 lg:border-r lg:border-b-0"
    >
      <NavigationTree />
    </Sidebar>
  );
}

/**
 * The links, rendered once.
 *
 * Whichever container the region chose — the rail or the sheet — this is the
 * only place a route appears and the only place `isActivePath` is called, so
 * "the current page" cannot be two different answers on one screen.
 */
function NavigationTree({ onNavigate }: { readonly onNavigate?: () => void }) {
  const t = useTranslations("Navigation");
  const pathname = usePathname();

  return (
    <nav
      id={NAV_ID}
      aria-label={t("primary")}
      className="flex min-h-0 flex-1 flex-col"
    >
      <SidebarContent className="gap-0 p-3">
        {DESKTOP_NAVIGATION.map((section) => (
          <SidebarGroup key={section.labelKey} className="p-0 pb-4 last:pb-0">
            <SidebarGroupLabel className="px-3 text-xs font-semibold tracking-wide text-muted uppercase">
              {t(section.labelKey)}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        className={`min-h-touch px-3 text-sm font-medium ${
                          active
                            ? "border-l-4 border-accent bg-raised font-semibold text-accent"
                            : "text-text"
                        }`}
                      >
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          {...(onNavigate === undefined
                            ? {}
                            : { onClick: onNavigate })}
                        >
                          {t(item.labelKey)}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </nav>
  );
}
