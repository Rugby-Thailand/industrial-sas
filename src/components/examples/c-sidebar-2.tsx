"use client";

// Adapted from @reui/c-sidebar-2: branded header, icon rail, account footer,
// and inset content. Routes and account information come from the real app.
// Navigation rows, their presentation data and the drawer search handoff
// live in `@/components/shell`.
import {
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { Building2, PanelLeft, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import {
  NavigationContent,
  NavigationProgressProvider,
} from "@/components/system/NavigationProgress";
import { SkipToContentLink } from "@/components/shell/SkipToContentLink";
import { AccountButton } from "@/components/shell/AccountButton";
import { HrLandingRedirect } from "@/components/shell/HrLandingRedirect";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { GlobalSearchProvider } from "@/components/shell/search/GlobalSearchProvider";
import { SidebarSearchTriggers } from "@/components/shell/search/SearchTriggers";
import { SidebarNavigation } from "@/components/shell/SidebarNavigation";
import { useDrawerSearchHandoff } from "@/components/shell/useDrawerSearchHandoff";
import { useOrganizationName } from "@/components/shell/useOrganizationName";
import { WorkspaceContextBar } from "@/components/shell/WorkspaceContextBar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePathname } from "@/i18n/navigation";
import { ROUTES } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const MAIN_ID = "main-content";
const NAV_ID = "primary-navigation";

/** Warehouse switching and creation belong to the top-level pages, not task or detail pages. */
const WORKSPACE_BAR_PATHS: readonly string[] = [
  ROUTES.finishedGoods,
  ROUTES.storageLayouts,
];

export function Pattern({ children }: { readonly children: ReactNode }) {
  const t = useTranslations("Navigation");
  const pathname = usePathname();
  const showWorkspaceBar = WORKSPACE_BAR_PATHS.includes(pathname);
  const usageReport = pathname === ROUTES.aiUsage;
  const menuOpener = useRef<HTMLButtonElement>(null);
  return (
    <TooltipProvider>
      <NavigationProgressProvider>
        <DraftGuardProvider>
          <GlobalSearchProvider>
            <SidebarProvider
              defaultOpen
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
              <AppSidebar
                switchableWarehouse={showWorkspaceBar}
                menuOpener={menuOpener}
              />
              <SidebarInset className="min-w-0 overflow-hidden">
                <header className="shrink-0 border-b border-border bg-surface px-3 py-2 lg:px-6">
                  <div className="flex items-center gap-1 sm:gap-2">
                    <MobileNavigationDisclosure menuOpener={menuOpener} />
                    <HeaderBrand />
                    <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
                      <LocaleSwitcher />
                      <ThemeToggle />
                    </div>
                  </div>
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
          </GlobalSearchProvider>
        </DraftGuardProvider>
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
      onClick={toggleSidebar}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      {...(!isMobile || openMobile ? { "aria-controls": NAV_ID } : {})}
    >
      {isMobile && openMobile ? (
        <X aria-hidden="true" />
      ) : (
        <PanelLeft aria-hidden="true" />
      )}
    </Button>
  );
}

/**
 * The organization this session works in, as the header's brand. Warehouse
 * context lives in the sidebar, so a phone header never carries it.
 */
function HeaderBrand() {
  const name = useOrganizationName();
  return (
    <p
      className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-text sm:text-base"
      title={name}
      data-testid="header-brand"
    >
      {name}
    </p>
  );
}

function AppSidebar({
  switchableWarehouse,
  menuOpener,
}: {
  readonly switchableWarehouse: boolean;
  readonly menuOpener: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations("Navigation");
  const app = useTranslations("App");
  const organizationName = useOrganizationName();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = !isMobile && state === "collapsed";
  const searchHandoff = useDrawerSearchHandoff(menuOpener);
  return (
    <Sidebar
      collapsible="icon"
      {...(!isMobile
        ? { role: "complementary", "aria-label": t("primary") }
        : { onMobileCloseAutoFocus: searchHandoff.onDrawerCloseAutoFocus })}
      className="absolute h-full border-border"
      mobileTitle={t("primary")}
      mobileCloseLabel={t("closeMenu")}
    >
      <SidebarHeader
        className={cn("gap-6 px-4 pt-5 pb-2", collapsed && "gap-3 p-2")}
      >
        <div className="flex items-center gap-1">
          {/* Compact identity: app name over the warehouse, beside the toggle. */}
          <div
            className={cn(
              "flex min-h-touch min-w-0 flex-1 items-center gap-3 dense:min-h-control",
              collapsed && "sr-only",
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Building2 className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{app("name")}</p>
              {collapsed ? null : (
                <WorkspaceContextBar switchable={switchableWarehouse} />
              )}
            </div>
          </div>
          <NavigationDisclosure />
        </div>
        {collapsed ? (
          <WorkspaceContextBar switchable={switchableWarehouse} collapsed />
        ) : null}
        <SidebarSearchTriggers
          collapsed={collapsed}
          {...(isMobile ? { onOpen: searchHandoff.request } : {})}
        />
      </SidebarHeader>
      <SidebarNavigation
        id={NAV_ID}
        collapsed={collapsed}
        onNavigate={() => setOpenMobile(false)}
      />
      <SidebarFooter
        className={cn(
          "mx-4 border-t border-sidebar-border px-0 py-4",
          collapsed && "mx-2 p-0 py-2",
        )}
      >
        <div className="flex min-h-12 items-center gap-3">
          <div className="shrink-0">
            <AccountButton />
          </div>
          <span
            className={
              collapsed ? "sr-only" : "min-w-0 truncate text-sm font-medium"
            }
          >
            {organizationName}
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
