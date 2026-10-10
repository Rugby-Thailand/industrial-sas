"use client";

import { Search, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import { useSearchControls } from "./GlobalSearchProvider";

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

/** Search and AI Search under the sidebar branding, as rows or icons. */
export function SidebarSearchTriggers({
  collapsed,
}: {
  readonly collapsed: boolean;
}) {
  const t = useTranslations("Search");
  const controls = useSearchControls();
  const shortcut = useShortcutLabel();
  if (controls === null) return null;
  const searchLabel = t("triggerLabel", { shortcut });
  return (
    <SidebarMenu className="gap-1 pt-2">
      <SidebarMenuItem>
        <SidebarMenuButton
          type="button"
          onClick={() => controls.open("SEARCH")}
          aria-label={searchLabel}
          aria-haspopup="dialog"
          {...(collapsed ? { tooltip: searchLabel } : {})}
          className={`min-h-touch border border-sidebar-border bg-sidebar text-sm text-sidebar-foreground/80 group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:justify-center ${collapsed ? "justify-center" : "px-3"}`}
          data-testid="sidebar-search"
        >
          <Search aria-hidden="true" className="size-4" />
          <span className={collapsed ? "sr-only" : "flex-1 truncate"}>
            {t("trigger")}
          </span>
          {collapsed ? null : (
            <kbd className="rounded border border-sidebar-border px-1.5 text-xs text-sidebar-foreground/70">
              {shortcut}
            </kbd>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
      {controls.aiAvailable ? (
        <SidebarMenuItem>
          <SidebarMenuButton
            type="button"
            onClick={() => controls.open("AI")}
            aria-label={t("aiTriggerLabel")}
            aria-haspopup="dialog"
            {...(collapsed ? { tooltip: t("aiTriggerLabel") } : {})}
            className={`min-h-touch text-sm font-medium text-link group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:justify-center ${collapsed ? "justify-center" : "px-3"}`}
            data-testid="sidebar-ai-search"
          >
            <Sparkles aria-hidden="true" className="size-4" />
            <span className={collapsed ? "sr-only" : "truncate"}>
              {t("aiTrigger")}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
    </SidebarMenu>
  );
}

/** The phone header's search button; AI Search is inside the dialog. */
export function MobileSearchButton() {
  const t = useTranslations("Search");
  const controls = useSearchControls();
  if (controls === null) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => controls.open("SEARCH")}
      aria-label={t("mobileTriggerLabel")}
      aria-haspopup="dialog"
      title={t("mobileTriggerLabel")}
      data-testid="mobile-search"
    >
      <Search aria-hidden="true" />
    </Button>
  );
}
