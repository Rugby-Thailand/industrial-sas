"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import { useSearchControls, type SearchMode } from "./GlobalSearchProvider";

const subscribeNever = () => () => {};
/** ⌘K on Apple platforms, Ctrl K elsewhere; resolved after hydration. */
function useShortcutLabel(): string {
  return useSyncExternalStore(
    subscribeNever,
    () =>
      /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
        ? "⌘K"
        : "Ctrl K",
    () => "Ctrl K",
  );
}

/** One sidebar entry for page, record and AI search. */
export function SidebarSearchTriggers({
  collapsed,
  onOpen,
}: {
  readonly collapsed: boolean;
  readonly onOpen?: (mode: SearchMode) => void;
}) {
  const t = useTranslations("Search");
  const controls = useSearchControls();
  const shortcut = useShortcutLabel();
  if (controls === null) return null;
  const open = onOpen ?? controls.open;
  const searchLabel = t("triggerLabel", { shortcut });
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          type="button"
          onClick={() => open("SEARCH")}
          aria-label={searchLabel}
          aria-haspopup="dialog"
          {...(collapsed ? { tooltip: searchLabel } : {})}
          className={`min-h-touch gap-3 border border-transparent bg-raised text-sm text-muted group-data-[collapsible=icon]:justify-center dense:min-h-control ${collapsed ? "justify-center" : "px-3"}`}
          data-testid="sidebar-search"
        >
          <Search aria-hidden="true" className="size-4" />
          <span className={collapsed ? "sr-only" : "flex-1 truncate"}>
            {t("trigger")}
          </span>
          {collapsed ? null : (
            <kbd className="rounded border border-sidebar-border bg-sidebar-accent px-1.5 py-0.5 text-xs text-muted">
              {shortcut}
            </kbd>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
