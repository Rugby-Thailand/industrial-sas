"use client";

// Adapted from @reui/c-sidebar-2: branded header, icon rail, account footer,
// and inset content. Routes and account information come from the real app.
import { type CSSProperties, type ReactNode } from "react";
import { Boxes, Building2, PanelLeft, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { AccountButton } from "@/components/shell/AccountButton";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { NavigationPendingIndicator } from "@/components/shell/NavigationPendingIndicator";
import { WorkspaceContextBar } from "@/components/shell/WorkspaceContextBar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Link, usePathname } from "@/i18n/navigation";
import {
  isActivePath,
  ROUTES,
  visibleDesktopNavigation,
} from "@/lib/navigation";

const MAIN_ID = "main-content";
const NAV_ID = "primary-navigation";

export function Pattern({ children }: { readonly children: ReactNode }) {
  const t = useTranslations("Navigation");
  return (
    <TooltipProvider>
      <SidebarProvider
        className="relative h-dvh min-h-0 w-full overflow-hidden bg-canvas text-text"
        style={{ "--sidebar-width-icon": "4rem" } as CSSProperties}
      >
        <a
          href={`#${MAIN_ID}`}
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
        >
          {t("skipToContent")}
        </a>
        <AppSidebar />
        <SidebarInset className="min-w-0 overflow-hidden">
          <header className="shrink-0 border-b border-border bg-surface px-4 py-3 lg:px-6">
            <div className="flex flex-wrap items-center gap-3">
              <NavigationDisclosure />
              <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
                <WorkspaceContextBar />
              </div>
              <div className="ml-auto">
                <LocaleSwitcher />
              </div>
              <ThemeToggle />
            </div>
          </header>
          <main
            id={MAIN_ID}
            tabIndex={-1}
            className="min-w-0 flex-1 overflow-auto p-4 lg:p-6"
          >
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

function NavigationDisclosure() {
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

function AppSidebar() {
  const t = useTranslations("Navigation");
  const app = useTranslations("App");
  const workspace = useWorkspace();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = !isMobile && state === "collapsed";
  return (
    <Sidebar
      collapsible="icon"
      className="absolute h-full border-border"
      mobileTitle={t("primary")}
      mobileCloseLabel={t("closeMenu")}
    >
      <SidebarHeader className="border-b border-border">
        <div className="flex items-center">
          <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Building2 className="size-4" aria-hidden="true" />
            </span>
            <span
              className={
                collapsed ? "sr-only" : "min-w-0 truncate text-sm font-semibold"
              }
            >
              {app("name")}
            </span>
          </div>
          {isMobile ? <NavigationDisclosure /> : null}
        </div>
      </SidebarHeader>
      <NavigationTree
        collapsed={collapsed}
        onNavigate={() => setOpenMobile(false)}
      />
      <SidebarFooter className="border-t border-border p-3">
        <div className="flex min-h-12 items-center gap-3">
          <div className="shrink-0">
            <AccountButton />
          </div>
          <span
            className={
              collapsed ? "sr-only" : "min-w-0 truncate text-sm font-medium"
            }
          >
            {workspace.organization?.name ?? app("name")}
          </span>
        </div>
      </SidebarFooter>
      <SidebarRail
        aria-label={t(collapsed ? "expandSidebar" : "collapseSidebar")}
        title={t(collapsed ? "expandSidebar" : "collapseSidebar")}
      />
    </Sidebar>
  );
}
const NAVIGATION_ICONS: Readonly<Record<string, LucideIcon>> = Object.freeze({
  [ROUTES.storageLayouts]: Building2,
});

function NavigationTree({
  onNavigate,
  collapsed = false,
}: {
  readonly onNavigate?: () => void;
  readonly collapsed?: boolean;
}) {
  const t = useTranslations("Navigation");
  const pathname = usePathname();
  const workspace = useWorkspace();
  const sections = workspace.permissionsReady
    ? visibleDesktopNavigation(workspace.navigationPermissions)
    : [];

  return (
    <nav
      id={NAV_ID}
      aria-label={t("primary")}
      className="flex min-h-0 flex-1 flex-col"
    >
      <SidebarContent className="gap-0">
        {!workspace.permissionsReady ? (
          <p role="status" className="px-3 py-4 text-sm text-muted">
            {t("loadingNavigation")}
          </p>
        ) : null}
        {sections.map((section) => (
          <SidebarGroup key={section.labelKey} className={"px-2 py-3"}>
            <SidebarGroupLabel
              className={
                collapsed
                  ? "sr-only"
                  : "px-2 text-xs font-medium text-sidebar-foreground/70"
              }
            >
              {t(section.labelKey)}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  const Icon = NAVIGATION_ICONS[item.href] ?? Boxes;
                  const label = t(item.labelKey);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        {...(collapsed ? { tooltip: label } : {})}
                        className={`min-h-touch text-sm font-medium group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:justify-center ${
                          collapsed ? "justify-center" : "px-3"
                        } ${
                          active
                            ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                            : "text-sidebar-foreground"
                        }`}
                      >
                        <Link
                          href={item.href}
                          className="relative"
                          aria-current={active ? "page" : undefined}
                          {...(onNavigate === undefined
                            ? {}
                            : { onClick: onNavigate })}
                        >
                          <Icon aria-hidden="true" className="size-4" />
                          <span className={collapsed ? "sr-only" : "truncate"}>
                            {label}
                          </span>
                          <NavigationPendingIndicator />
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
