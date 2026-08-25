"use client";

import { useTranslations } from "next-intl";
import {
  ArrowLeftRight,
  BarChart3,
  Barcode,
  Boxes,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  ClipboardPenLine,
  Container,
  Database,
  Factory,
  FileCog,
  FileSpreadsheet,
  FileStack,
  Forklift,
  Gauge,
  History,
  Import,
  Layers3,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Menu,
  PackagePlus,
  PanelsTopLeft,
  PlugZap,
  Route,
  ShieldCheck,
  TabletSmartphone,
  Truck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
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
import { TooltipProvider } from "@/components/ui/tooltip";
import { Link, usePathname } from "@/i18n/navigation";
import {
  isActivePath,
  ROUTES,
  visibleDesktopNavigation,
} from "@/lib/navigation";

import { LocaleSwitcher } from "./LocaleSwitcher";
import { AccountButton } from "./AccountButton";
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

      <div className="flex min-w-0 flex-1">
        <NavigationRegion />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-border bg-surface px-4 py-3 lg:px-6">
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 sm:flex sm:flex-wrap sm:gap-4">
              <NavigationDisclosure />
              <div className="order-last col-span-3 min-w-0 sm:order-none sm:flex-1">
                <WorkspaceContextBar />
              </div>
              <div className="min-w-0 justify-self-end">
                <LocaleSwitcher />
              </div>
              <AccountButton />
            </div>
          </header>
          <main id={MAIN_ID} className="min-w-0 flex-1 p-4 lg:p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

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

function NavigationRegion() {
  const t = useTranslations("Navigation");
  const { isMobile, openMobile, setOpenMobile, state, toggleSidebar } =
    useSidebar();
  const collapsed = state === "collapsed";

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
      className={`hidden h-dvh shrink-0 border-r border-border transition-[width] duration-200 lg:flex ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div
        className={`flex h-12 shrink-0 items-center border-b border-sidebar-border px-2 ${
          collapsed ? "justify-center" : "justify-end"
        }`}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t(collapsed ? "expandSidebar" : "collapseSidebar")}
          aria-expanded={!collapsed}
          aria-controls={NAV_ID}
          onClick={toggleSidebar}
        >
          {collapsed ? (
            <ChevronsRight aria-hidden="true" className="size-5" />
          ) : (
            <ChevronsLeft aria-hidden="true" className="size-5" />
          )}
        </Button>
      </div>
      <TooltipProvider>
        <NavigationTree collapsed={collapsed} />
      </TooltipProvider>
    </Sidebar>
  );
}

const NAVIGATION_ICONS: Readonly<Record<string, LucideIcon>> = Object.freeze({
  [ROUTES.dashboard]: LayoutDashboard,
  [ROUTES.items]: Barcode,
  [ROUTES.suppliers]: Users,
  [ROUTES.storageClasses]: Layers3,
  [ROUTES.labelTemplates]: FileStack,
  [ROUTES.locations]: MapPin,
  [ROUTES.storageLayouts]: Building2,
  [ROUTES.customerOrders]: ClipboardPenLine,
  [ROUTES.engineeringQueue]: BarChart3,
  [ROUTES.factoryPackets]: Factory,
  [ROUTES.productionOrders]: Gauge,
  [ROUTES.fulfillment]: Route,
  [ROUTES.transport]: Truck,
  [ROUTES.transfers]: ArrowLeftRight,
  [ROUTES.purchaseOrders]: Truck,
  [ROUTES.inboundBoard]: PanelsTopLeft,
  [ROUTES.purchaseImport]: Import,
  [ROUTES.receiving]: PackagePlus,
  [ROUTES.quality]: ShieldCheck,
  [ROUTES.putaway]: Forklift,
  [ROUTES.balances]: Database,
  [ROUTES.history]: History,
  [ROUTES.openingStock]: Container,
  [ROUTES.countPlans]: ListChecks,
  [ROUTES.reports]: FileSpreadsheet,
  [ROUTES.hr]: Users,
  [ROUTES.integrations]: PlugZap,
  [ROUTES.handheld]: TabletSmartphone,
  [ROUTES.devices]: FileCog,
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
      <SidebarContent className={collapsed ? "gap-0 p-2" : "gap-0 p-3"}>
        {!workspace.permissionsReady ? (
          <p role="status" className="px-3 py-4 text-sm text-muted">
            {t("loadingNavigation")}
          </p>
        ) : null}
        {sections.map((section) => (
          <SidebarGroup
            key={section.labelKey}
            className={collapsed ? "p-0 pb-2 last:pb-0" : "p-0 pb-4 last:pb-0"}
          >
            <SidebarGroupLabel
              className={
                collapsed
                  ? "sr-only"
                  : "px-3 text-xs font-semibold tracking-wide text-muted uppercase"
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
                        className={`min-h-touch text-sm font-medium ${
                          collapsed ? "justify-center px-2" : "px-3"
                        } ${
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
                          <Icon aria-hidden="true" className="size-4" />
                          <span className={collapsed ? "sr-only" : "truncate"}>
                            {label}
                          </span>
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
