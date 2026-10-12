"use client";

// Adapted from @reui/c-sidebar-2: branded header, icon rail, account footer,
// and inset content. Routes and account information come from the real app.
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Bell,
  Megaphone,
  FileText,
  FileUp,
  ChartNoAxesCombined,
  Boxes,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  ClipboardList,
  Clock,
  History,
  PanelLeft,
  Settings,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { useAiUsageAccess } from "@/components/providers/AiUsageAccessProvider";
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import {
  NavigationContent,
  NavigationProgressProvider,
} from "@/components/system/NavigationProgress";
import { SidebarNavigationLink } from "@/components/shell/SidebarNavigationLink";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { AccountButton } from "@/components/shell/AccountButton";
import { HrLandingRedirect } from "@/components/shell/HrLandingRedirect";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { NavigationPendingIndicator } from "@/components/shell/NavigationPendingIndicator";
import {
  GlobalSearchProvider,
  useGrantedPermissions,
  useSearchControls,
  type SearchMode,
} from "@/components/shell/search/GlobalSearchProvider";
import { SidebarSearchTriggers } from "@/components/shell/search/SearchTriggers";
import { WorkspaceContextBar } from "@/components/shell/WorkspaceContextBar";
import { Button } from "@/components/ui/button";
import { ScanIcon } from "@/components/ui/ScanIcon";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePathname } from "@/i18n/navigation";
import {
  activeNavigationHref,
  ROUTES,
  visibleDesktopNavigation,
  type NavigationItem,
} from "@/lib/navigation";

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
                  "--sidebar-width": "17rem",
                } as CSSProperties
              }
            >
              <a
                href={`#${MAIN_ID}`}
                className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
              >
                {t("skipToContent")}
              </a>
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
  const app = useTranslations("App");
  const workspace = useWorkspace();
  const hr = useHrAccess();
  const usage = useAiUsageAccess();
  const name =
    workspace.organization?.name ??
    hr.organizationName ??
    usage.organizationName ??
    app("name");
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
  const workspace = useWorkspace();
  const hr = useHrAccess();
  const usage = useAiUsageAccess();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = !isMobile && state === "collapsed";
  const searchHandoff = useDrawerSearchHandoff(menuOpener, [
    workspace.organization?.id,
    workspace.selectedWarehouseId,
    hr.identityKey,
  ]);
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
      <SidebarHeader className={cn("gap-3 p-3", collapsed && "p-2")}>
        <div className="flex items-center gap-1">
          <div
            className={cn(
              "flex min-h-touch min-w-0 flex-1 items-center gap-3 dense:min-h-control",
              collapsed && "sr-only",
            )}
          >
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
          <NavigationDisclosure />
        </div>
        <WorkspaceContextBar
          switchable={switchableWarehouse}
          collapsed={collapsed}
        />
        <SidebarSearchTriggers
          collapsed={collapsed}
          {...(isMobile ? { onOpen: searchHandoff.request } : {})}
        />
      </SidebarHeader>
      <NavigationTree
        collapsed={collapsed}
        onNavigate={() => setOpenMobile(false)}
      />
      <SidebarFooter
        className={cn("border-t border-border p-3", collapsed && "p-2")}
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
            {workspace.organization?.name ??
              hr.organizationName ??
              usage.organizationName ??
              app("name")}
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
const NAVIGATION_ICONS: Readonly<Record<string, LucideIcon>> = Object.freeze({
  [ROUTES.aiUsage]: ChartNoAxesCombined,
  [ROUTES.storageLayouts]: Building2,
  [ROUTES.jobScan]: ScanIcon,
  [ROUTES.jobScanRecords]: ClipboardList,
  [ROUTES.hrToday]: Clock,
  [ROUTES.hrTime]: History,
  [ROUTES.hrRequests]: ClipboardList,
  [ROUTES.hrHolidays]: CalendarDays,
  [ROUTES.hrLeave]: CalendarDays,
  [ROUTES.hrLeaveReview]: CalendarCheck,
  [ROUTES.hrAnnouncements]: Megaphone,
  [ROUTES.hrAnnouncementsManage]: Megaphone,
  [ROUTES.hrNotifications]: Bell,
  [ROUTES.hrPayslips]: FileText,
  [ROUTES.hrPayslipImport]: FileUp,
  [ROUTES.hrProfile]: UserRound,
  [ROUTES.hrReview]: CalendarCheck,
  [ROUTES.hrEmployees]: UsersRound,
  [ROUTES.hrPeriods]: CalendarRange,
  [ROUTES.hrSettings]: Settings,
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
  const hr = useHrAccess();
  const usage = useAiUsageAccess();
  // Storage, HR and AI usage grants settle independently. A storage denial is
  // a settled answer (an HR-only or usage-only member), not a reason to keep
  // the menu loading.
  const workspaceSettled =
    workspace.permissionsReady || workspace.denied || workspace.failed;
  const hrSettled = hr.status !== "LOADING";
  const usageSettled = usage.status !== "LOADING";
  const sections = visibleDesktopNavigation(useGrantedPermissions());
  const navigationLoading =
    !(workspaceSettled && hrSettled && usageSettled) && sections.length === 0;
  const activeHref = activeNavigationHref(
    pathname,
    sections.flatMap((section) => section.items.map((item) => item.href)),
  );

  return (
    <nav
      id={NAV_ID}
      aria-label={t("primary")}
      className="flex min-h-0 flex-1 flex-col"
    >
      <SidebarContent className={cn("gap-4 px-3 py-4", collapsed && "px-2")}>
        {navigationLoading ? (
          <p role="status" className="px-3 py-4 text-sm text-muted">
            {t("loadingNavigation")}
          </p>
        ) : null}
        {sections.map((section) => (
          <SidebarGroup
            key={section.labelKey}
            className="p-0 [&+&]:border-t [&+&]:border-sidebar-border [&+&]:pt-4"
          >
            <SidebarGroupLabel
              className={
                collapsed
                  ? "sr-only"
                  : "mb-2 px-3 text-xs font-medium text-muted"
              }
            >
              {t(section.labelKey)}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {groupSidebarItems(section.items).map((entry) =>
                  "items" in entry ? (
                    <NavigationSubmenu
                      key={entry.labelKey}
                      entry={entry}
                      activeHref={activeHref}
                      collapsed={collapsed}
                      {...(onNavigate === undefined ? {} : { onNavigate })}
                    />
                  ) : (
                    <NavigationLeaf
                      key={entry.href}
                      item={entry}
                      activeHref={activeHref}
                      collapsed={collapsed}
                      {...(onNavigate === undefined ? {} : { onNavigate })}
                    />
                  ),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </nav>
  );
}

interface SidebarSubmenu {
  readonly labelKey: string;
  readonly Icon: LucideIcon;
  readonly items: readonly NavigationItem[];
}

// Presentation groups do not change the search registry or permission checks.
// Only destinations already granted to this member enter a submenu.
const SIDEBAR_SUBMENUS = [
  {
    labelKey: "hrAttendance",
    Icon: Clock,
    hrefs: [ROUTES.hrToday, ROUTES.hrTime, ROUTES.hrProfile],
  },
  {
    labelKey: "hrLeave",
    Icon: CalendarDays,
    hrefs: [ROUTES.hrLeave, ROUTES.hrLeaveReview, ROUTES.hrHolidays],
  },
  {
    labelKey: "hrAnnouncements",
    Icon: Megaphone,
    hrefs: [
      ROUTES.hrAnnouncements,
      ROUTES.hrAnnouncementsManage,
      ROUTES.hrNotifications,
    ],
  },
  {
    labelKey: "hrPayslips",
    Icon: FileText,
    hrefs: [ROUTES.hrPayslips, ROUTES.hrPayslipImport],
  },
  {
    labelKey: "hrAdministration",
    Icon: Settings,
    hrefs: [
      ROUTES.hrReview,
      ROUTES.hrEmployees,
      ROUTES.hrPeriods,
      ROUTES.hrSettings,
    ],
  },
] as const;

function groupSidebarItems(
  items: readonly NavigationItem[],
): readonly (NavigationItem | SidebarSubmenu)[] {
  const emitted = new Set<string>();
  return items.flatMap((item): (NavigationItem | SidebarSubmenu)[] => {
    const group = SIDEBAR_SUBMENUS.find((entry) =>
      (entry.hrefs as readonly string[]).includes(item.href),
    );
    if (group === undefined) return [item];
    if (emitted.has(group.labelKey)) return [];
    emitted.add(group.labelKey);
    return [
      {
        labelKey: group.labelKey,
        Icon: group.Icon,
        items: group.hrefs.flatMap((href) =>
          items.filter((candidate) => candidate.href === href),
        ),
      },
    ];
  });
}

function NavigationLeaf({
  item,
  activeHref,
  collapsed,
  onNavigate,
  nested = false,
}: {
  readonly item: NavigationItem;
  readonly activeHref: string | undefined;
  readonly collapsed: boolean;
  readonly onNavigate?: () => void;
  readonly nested?: boolean;
}) {
  const t = useTranslations("Navigation");
  const active = item.href === activeHref;
  const Icon = NAVIGATION_ICONS[item.href] ?? Boxes;
  const label = t(
    nested
      ? ({
          [ROUTES.hrLeave]: "hrMyLeave",
          [ROUTES.hrAnnouncements]: "hrAnnouncementsFeed",
          [ROUTES.hrPayslips]: "hrMyPayslips",
        }[item.href] ?? item.labelKey)
      : item.labelKey,
  );
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        {...(collapsed ? { tooltip: label } : {})}
        className={cn(
          "min-h-touch gap-3 text-sm font-medium group-data-[collapsible=icon]:justify-center dense:min-h-control",
          collapsed ? "justify-center" : "px-3",
          active && "font-semibold",
        )}
      >
        <SidebarNavigationLink
          href={item.href}
          className="relative"
          aria-current={active ? "page" : undefined}
          {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
        >
          {nested ? null : <Icon aria-hidden="true" className="size-4" />}
          <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
          <NavigationPendingIndicator />
        </SidebarNavigationLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function NavigationSubmenu({
  entry,
  activeHref,
  collapsed,
  onNavigate,
}: {
  readonly entry: SidebarSubmenu;
  readonly activeHref: string | undefined;
  readonly collapsed: boolean;
  readonly onNavigate?: () => void;
}) {
  const t = useTranslations("Navigation");
  const { setOpen } = useSidebar();
  const submenuId = useId();
  const active = entry.items.some((item) => item.href === activeHref);
  const [expanded, setExpanded] = useState(active);
  // A search result or browser history can enter a child without a menu click.
  // Reveal that destination on arrival, while still allowing manual collapse.
  const [previousHref, setPreviousHref] = useState(activeHref);
  if (previousHref !== activeHref) {
    setPreviousHref(activeHref);
    if (active) setExpanded(true);
  }
  const open = expanded && !collapsed;
  const label = t(entry.labelKey);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        isActive={active && !open}
        aria-expanded={open}
        aria-controls={submenuId}
        {...(collapsed ? { tooltip: label } : {})}
        className={cn(
          "min-h-touch gap-3 text-sm font-medium group-data-[collapsible=icon]:justify-center dense:min-h-control",
          collapsed ? "justify-center" : "px-3",
        )}
        onClick={() => {
          if (collapsed) {
            setOpen(true);
            setExpanded(true);
          } else setExpanded((value) => !value);
        }}
      >
        <entry.Icon aria-hidden="true" className="size-4" />
        <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>
          {label}
        </span>
        {collapsed ? null : (
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "text-muted transition-transform motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
        )}
      </SidebarMenuButton>
      <ul
        id={submenuId}
        hidden={!open}
        className="mt-1 ml-5 space-y-1 border-l border-sidebar-border pl-3"
        aria-label={label}
      >
        {entry.items.map((item) => (
          <NavigationLeaf
            key={item.href}
            item={item}
            activeHref={activeHref}
            collapsed={false}
            nested
            {...(onNavigate === undefined ? {} : { onNavigate })}
          />
        ))}
      </ul>
    </SidebarMenuItem>
  );
}

/**
 * Search chosen inside the mobile drawer opens only once the drawer has
 * finished closing, from the header's menu button, so the dialog never
 * stacks on the sheet and Escape returns to a connected control. The
 * request is held for that one close: reopening the drawer, a route change,
 * a different organization, warehouse or signed-in actor, or leaving the
 * phone layout drops it, so an unrelated later close never opens a delayed
 * Search.
 */
function useDrawerSearchHandoff(
  menuOpener: RefObject<HTMLButtonElement | null>,
  [organizationId, warehouseId, actorKey]: readonly [
    organizationId: string | undefined,
    warehouseId: string | undefined,
    actorKey: string | undefined,
  ],
) {
  const controls = useSearchControls();
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const pathname = usePathname();
  // One primitive for the route and workspace the request was made in.
  const context = JSON.stringify([
    pathname,
    organizationId ?? null,
    warehouseId ?? null,
    actorKey ?? null,
  ]);
  const queued = useRef<{
    readonly mode: SearchMode;
    readonly context: string;
  } | null>(null);

  useEffect(() => {
    if (openMobile) queued.current = null;
  }, [openMobile]);
  useEffect(
    () => () => {
      queued.current = null;
    },
    [isMobile, context],
  );

  const request = useCallback(
    (mode: SearchMode) => {
      queued.current = { mode, context };
      setOpenMobile(false);
    },
    [context, setOpenMobile],
  );
  const onDrawerCloseAutoFocus = useCallback(
    (event: Event) => {
      const pending = queued.current;
      queued.current = null;
      // A request made for another route or workspace never opens here.
      if (pending === null || pending.context !== context) return;
      if (controls === null) return;
      const { mode } = pending;
      const opener = menuOpener.current;
      if (opener?.isConnected) {
        event.preventDefault();
        opener.focus();
      }
      controls.open(mode);
    },
    [context, controls, menuOpener],
  );
  return { request, onDrawerCloseAutoFocus };
}
