import { Spinner } from "@/components/ui/spinner";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { useAiUsageAccess } from "@/components/providers/AiUsageAccessProvider";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { NavigationPendingIndicator } from "@/components/shell/NavigationPendingIndicator";
import { useGrantedPermissions } from "@/components/shell/search/GlobalSearchProvider";
import { SidebarNavigationLink } from "@/components/shell/SidebarNavigationLink";
import {
  groupSidebarItems,
  navigationLabelKey,
  type SidebarEntry,
} from "@/components/shell/sidebarEntries";
import { sidebarRowClassName } from "@/components/shell/sidebarRow";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { usePathname } from "@/i18n/navigation";
import {
  activeNavigationHref,
  visibleDesktopNavigation,
  type NavigationItem,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface RowProps {
  readonly activeHref: string | undefined;
  readonly collapsed: boolean;
  /** The mobile drawer's handoff for a chosen destination (see the link). */
  readonly onNavigate: ((href: string) => void) | undefined;
}

/**
 * The permitted destinations, by section. Only granted items are grouped, and
 * the most specific matching destination is the current page.
 */
export function SidebarNavigation({
  id,
  collapsed,
  onNavigate,
}: {
  readonly id: string;
  readonly collapsed: boolean;
  readonly onNavigate?: (href: string) => void;
}) {
  const t = useTranslations("Navigation");
  const pathname = usePathname();
  const workspace = useWorkspace();
  const hr = useHrAccess();
  const usage = useAiUsageAccess();
  const labelPrefix = useId();
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
  const row: RowProps = { activeHref, collapsed, onNavigate };
  const { isMobile, openMobile } = useSidebar();
  const contentRef = useRef<HTMLDivElement>(null);
  // Reveal on each opening, including reopening during the closing animation,
  // once grants settle so the active row and its open submenu are final.
  useRevealActiveRow(
    contentRef,
    isMobile && openMobile,
    workspaceSettled && hrSettled && usageSettled && activeHref !== undefined,
  );

  return (
    <nav
      id={id}
      aria-label={t("primary")}
      className="flex min-h-0 flex-1 flex-col"
    >
      <SidebarContent
        ref={contentRef}
        className={cn("gap-6 px-4 py-4", collapsed && "px-2")}
      >
        {navigationLoading ? (
          <p
            role="status"
            className={
              collapsed
                ? "flex justify-center px-2 py-4 text-muted"
                : "px-3 py-4 text-sm text-muted"
            }
          >
            {collapsed ? (
              <Spinner aria-hidden="true" className="size-4" />
            ) : null}
            <span className={collapsed ? "sr-only" : undefined}>
              {t("loadingNavigation")}
            </span>
          </p>
        ) : null}
        {sections.map((section) => {
          const labelId = `${labelPrefix}-${section.labelKey}`;
          return (
            <SidebarGroup
              key={section.labelKey}
              className="p-0 [&+&]:border-t [&+&]:border-sidebar-border [&+&]:pt-5"
            >
              <SidebarGroupLabel
                id={labelId}
                className={
                  collapsed
                    ? "sr-only"
                    : "mb-2 px-3 text-xs font-medium text-muted"
                }
              >
                {t(section.labelKey)}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1" aria-labelledby={labelId}>
                  {groupSidebarItems(section.items).map((entry) =>
                    entry.kind === "submenu" ? (
                      <NavigationSubmenu
                        key={entry.labelKey}
                        entry={entry}
                        {...row}
                      />
                    ) : (
                      <NavigationLeaf
                        key={entry.item.href}
                        item={entry.item}
                        Icon={entry.Icon}
                        {...row}
                      />
                    ),
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
    </nav>
  );
}

/**
 * Scrolls the current page's row into the drawer's visible area once per
 * opening, after `ready`. It sets only the drawer's own `scrollTop`, so the page
 * behind never scrolls and focus never moves. A row already in view is left
 * where it is, and any wheel, touch, pointer or key input in the drawer
 * before the reveal hands control to the user.
 */
function useRevealActiveRow(
  containerRef: RefObject<HTMLElement | null>,
  open: boolean,
  ready: boolean,
) {
  const done = useRef(false);
  useEffect(() => {
    if (!open) {
      done.current = false;
      return;
    }
    const container = containerRef.current;
    if (!container || done.current) return;
    const takeOver = () => {
      done.current = true;
    };
    const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const type of inputs)
      container.addEventListener(type, takeOver, { passive: true });
    let frame: number | undefined;
    if (ready)
      frame = requestAnimationFrame(() => {
        if (done.current) return;
        done.current = true;
        const row = container.querySelector<HTMLElement>(
          '[aria-current="page"]',
        );
        if (!row) return;
        const box = container.getBoundingClientRect();
        const target = row.getBoundingClientRect();
        if (target.top >= box.top && target.bottom <= box.bottom) return;
        const centred =
          container.scrollTop +
          (target.top - box.top) -
          (box.height - target.height) / 2;
        container.scrollTop = Math.max(0, centred);
      });
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      for (const type of inputs) container.removeEventListener(type, takeOver);
    };
  }, [containerRef, open, ready]);
}

/** A destination row; nested rows sit in a submenu without their own icon. */
function NavigationLeaf({
  item,
  Icon,
  activeHref,
  collapsed,
  onNavigate,
  nested = false,
}: RowProps & {
  readonly item: NavigationItem;
  readonly Icon?: LucideIcon;
  readonly nested?: boolean;
}) {
  const t = useTranslations("Navigation");
  const active = item.href === activeHref;
  const label = t(navigationLabelKey(item, nested));
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        {...(collapsed ? { tooltip: label } : {})}
        className={sidebarRowClassName(
          collapsed,
          active && "font-semibold",
          nested && "text-muted dense:min-h-9",
        )}
      >
        <SidebarNavigationLink
          href={item.href}
          className="relative"
          aria-current={active ? "page" : undefined}
          {...(onNavigate === undefined
            ? {}
            : { navigate: () => onNavigate(item.href) })}
        >
          {Icon === undefined ? null : (
            <Icon aria-hidden="true" className="size-4" />
          )}
          <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
          <NavigationPendingIndicator />
        </SidebarNavigationLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * A collapsible group of related destinations. It opens on arrival at one of
 * its children; on the icon rail it expands the sidebar and then itself.
 */
function NavigationSubmenu({
  entry,
  activeHref,
  collapsed,
  onNavigate,
}: RowProps & {
  readonly entry: Extract<SidebarEntry, { kind: "submenu" }>;
}) {
  const t = useTranslations("Navigation");
  const { setOpen, isMobile, openMobile } = useSidebar();
  const submenuId = useId();
  const active = entry.items.some((item) => item.href === activeHref);
  const [expanded, setExpanded] = useState(active);
  // A search result or browser history can enter a child without a menu click.
  // Reveal that destination on arrival, while still allowing manual collapse.
  const [previousHref, setPreviousHref] = useState(activeHref);
  const [previousMobileOpen, setPreviousMobileOpen] = useState(openMobile);
  if (previousHref !== activeHref) {
    setPreviousHref(activeHref);
    if (active) setExpanded(true);
  }
  // A rapid reopen can preserve this component through the exit animation.
  // Restore the active group once per opening, while allowing collapse within it.
  if (previousMobileOpen !== openMobile) {
    setPreviousMobileOpen(openMobile);
    if (isMobile && openMobile && active) setExpanded(true);
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
        className={sidebarRowClassName(collapsed)}
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
      <SidebarMenu
        id={submenuId}
        hidden={!open}
        aria-label={label}
        // `w-auto` keeps the indented list inside its row; the menu default is full width.
        className="mt-1 mb-2 ml-5 w-auto gap-1 border-l border-sidebar-border pl-3"
      >
        {entry.items.map((item) => (
          <NavigationLeaf
            key={item.href}
            item={item}
            activeHref={activeHref}
            collapsed={false}
            onNavigate={onNavigate}
            nested
          />
        ))}
      </SidebarMenu>
    </SidebarMenuItem>
  );
}
