"use client";

// Adapted from @reui/c-sidebar-2: branded header, icon rail, account footer,
// and inset content. Routes and account information come from the real app.
// Navigation rows, their presentation data and the drawer search handoff
// live in `@/components/shell`.
import {
  useCallback,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { Menu, PanelLeft, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import {
  NavigationContent,
  NavigationProgressProvider,
} from "@/components/system/NavigationProgress";
import { SkipToContentLink } from "@/components/shell/SkipToContentLink";
import { SidebarAccount } from "@/components/shell/AccountButton";
import {
  ConnectionNotice,
  ConnectionStallProvider,
} from "@/components/shell/ConnectionNotice";
import { HrLandingRedirect } from "@/components/shell/HrLandingRedirect";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { GlobalSearchProvider } from "@/components/shell/search/GlobalSearchProvider";
import {
  HeaderSearchTrigger,
  SidebarSearchTriggers,
} from "@/components/shell/search/SearchTriggers";
import { SidebarNavigation } from "@/components/shell/SidebarNavigation";
import { useDrawerSearchHandoff } from "@/components/shell/useDrawerSearchHandoff";
import { useOrganizationName } from "@/components/shell/useOrganizationName";
import {
  HeaderWarehouse,
  WorkspaceContextBar,
} from "@/components/shell/WorkspaceContextBar";
import { useConnectionStall } from "@/components/system/connectionStall";
import { Button } from "@/components/ui/button";
import type { SheetCompletionHandle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  Sidebar,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePathname, useRouter } from "@/i18n/navigation";
import { ROUTES } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const MAIN_ID = "main-content";
const NAV_ID = "primary-navigation";

export function DesktopShell({
  children,
  defaultOpen = true,
}: {
  readonly children: ReactNode;
  /**
   * Whether the desktop sidebar starts expanded: the member's last choice,
   * read from the sidebar's cookie by the server layout, so the icon rail
   * survives a reload or a language switch. Phones always start closed.
   */
  readonly defaultOpen?: boolean;
}) {
  const t = useTranslations("Navigation");
  const pathname = usePathname();
  const usageReport = pathname === ROUTES.aiUsage;
  const menuOpener = useRef<HTMLButtonElement>(null);
  return (
    <TooltipProvider>
      <NavigationProgressProvider>
        <NavigationGuardProvider>
          <GlobalSearchProvider>
            {/* One stall answer for the notice and every loading presenter,
                including the phone drawer's portal. */}
            <ConnectionStallProvider>
              <SidebarProvider
                defaultOpen={defaultOpen}
                className="relative h-dvh min-h-0 w-full overflow-hidden bg-canvas text-text"
                style={
                  {
                    "--sidebar-width-icon": "4rem",
                    "--sidebar-width": "18rem",
                  } as CSSProperties
                }
              >
                <SkipToContentLink targetId={MAIN_ID}>
                  {t("skipToContent")}
                </SkipToContentLink>
                <HrLandingRedirect />
                <AppSidebar menuOpener={menuOpener} />
                <SidebarInset className="min-w-0 overflow-hidden">
                  <header className="shrink-0 border-b border-border bg-surface px-3 py-2 lg:px-6">
                    <div className="flex items-center gap-1 sm:gap-2">
                      <MobileNavigationDisclosure menuOpener={menuOpener} />
                      <HeaderBrand />
                      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
                        <HeaderSearchTrigger />
                        <LocaleSwitcher />
                        <ThemeToggle />
                      </div>
                    </div>
                    <ConnectionNotice />
                  </header>
                  <main
                    id={MAIN_ID}
                    tabIndex={-1}
                    className={
                      usageReport
                        ? "min-w-0 flex-1 overflow-auto bg-surface px-3.5 py-5 sm:px-6 sm:py-6 lg:px-9 lg:py-7"
                        : "min-w-0 flex-1 overflow-auto p-3 sm:p-4 lg:px-6 lg:py-4"
                    }
                  >
                    <NavigationContent>{children}</NavigationContent>
                  </main>
                </SidebarInset>
              </SidebarProvider>
            </ConnectionStallProvider>
          </GlobalSearchProvider>
        </NavigationGuardProvider>
      </NavigationProgressProvider>
    </TooltipProvider>
  );
}

/** Desktop disclosure stays inside the sidebar, including the icon rail. */
function MobileNavigationDisclosure({
  menuOpener,
}: {
  readonly menuOpener: RefObject<HTMLButtonElement | null>;
}) {
  const { isMobile } = useSidebar();
  return isMobile ? <NavigationDisclosure buttonRef={menuOpener} /> : null;
}

function NavigationDisclosure({
  buttonRef,
}: {
  readonly buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations("Navigation");
  const { isMobile, openMobile, open, toggleSidebar } = useSidebar();
  const expanded = isMobile ? openMobile : open;
  const label = t(
    isMobile
      ? expanded
        ? "closeMenu"
        : "openMenu"
      : expanded
        ? "collapseSidebar"
        : "expandSidebar",
  );
  return (
    <Button
      ref={buttonRef}
      variant="ghost"
      size="icon"
      data-slot="sidebar-trigger"
      className="aria-expanded:bg-transparent"
      onClick={toggleSidebar}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      {...(!isMobile || openMobile ? { "aria-controls": NAV_ID } : {})}
    >
      {/* A phone opens a drawer menu; the desktop toggle collapses a panel. */}
      {isMobile ? (
        openMobile ? (
          <X aria-hidden="true" data-testid="menu-close-icon" />
        ) : (
          <Menu aria-hidden="true" data-testid="menu-open-icon" />
        )
      ) : (
        <PanelLeft aria-hidden="true" data-testid="sidebar-toggle-icon" />
      )}
    </Button>
  );
}

/**
 * The organization this session works in, as the header's brand. Until it
 * resolves, a placeholder holds its place rather than repeating the product
 * name the sidebar already shows. The selected warehouse joins it as a
 * second line while the sidebar's selector is out of sight.
 */
function HeaderBrand() {
  const name = useOrganizationName();
  const waiting = useConnectionStall() !== null;
  const t = useTranslations("App");
  return (
    <div className="min-w-0 flex-1 px-1" data-testid="header-brand">
      {name === undefined && !waiting ? (
        <Skeleton
          aria-hidden="true"
          className="h-5 w-40 max-w-full"
          data-testid="header-brand-loading"
        />
      ) : (
        <p
          className="truncate text-sm font-semibold text-text sm:text-base"
          title={name}
        >
          {name ?? t("waitingForConnection")}
        </p>
      )}
      <HeaderWarehouse />
    </div>
  );
}

function AppSidebar({
  menuOpener,
}: {
  readonly menuOpener: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations("Navigation");
  const app = useTranslations("App");
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = !isMobile && state === "collapsed";
  const drawer = useRef<SheetCompletionHandle>(null);
  const searchHandoff = useDrawerSearchHandoff(menuOpener, drawer);
  // This router outlives the drawer's links, which unmount as it closes.
  const router = useRouter();
  // The drawer consumes its own entry first; only then does the route push,
  // so the drawer's native Back cannot restore the origin over it.
  const navigateFromDrawer = useCallback(
    (href: string) =>
      // Drawer links render only inside the drawer, so its handle is mounted.
      drawer.current?.complete(() => {
        // Normally already closed by its own Back; never left open otherwise.
        setOpenMobile(false);
        router.push(href);
      }),
    [router, setOpenMobile],
  );
  return (
    <Sidebar
      collapsible="icon"
      {...(!isMobile
        ? { role: "complementary", "aria-label": t("primary") }
        : {
            onMobileCloseAutoFocus: searchHandoff.onDrawerCloseAutoFocus,
            mobileCompletionRef: drawer,
          })}
      className="absolute h-full border-border"
      mobileTitle={t("primary")}
      mobileCloseLabel={t("closeMenu")}
    >
      <SidebarHeader className={cn("gap-3 px-4 pt-3 pb-2", collapsed && "p-2")}>
        {/* The product name on its own row, beside the toggle; the header
            names the organization, and the warehouse has its own label. */}
        <div
          className={cn(
            "flex items-center gap-1",
            collapsed && "justify-center",
          )}
        >
          <p
            className={cn(
              "min-w-0 flex-1 truncate text-base font-semibold",
              collapsed && "sr-only",
            )}
            data-testid="sidebar-brand"
          >
            {app("name")}
          </p>
          <NavigationDisclosure />
        </div>
        <WorkspaceContextBar collapsed={collapsed} />
        <SidebarSearchTriggers
          collapsed={collapsed}
          {...(isMobile ? { onOpen: searchHandoff.request } : {})}
        />
      </SidebarHeader>
      <SidebarNavigation
        id={NAV_ID}
        collapsed={collapsed}
        {...(isMobile ? { onNavigate: navigateFromDrawer } : {})}
      />
      <SidebarAccount collapsed={collapsed} />
    </Sidebar>
  );
}
