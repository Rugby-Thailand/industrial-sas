"use client";

import { Search, Sparkles, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
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

/** Search and AI Search under the sidebar branding, as rows or icons. */
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
  const triggers: {
    readonly mode: SearchMode;
    readonly Icon: LucideIcon;
    readonly label: string;
    readonly accessibleLabel: string;
    readonly testId: string;
    readonly shortcut?: string;
  }[] = [
    {
      mode: "SEARCH",
      Icon: Search,
      label: t("trigger"),
      accessibleLabel: searchLabel,
      testId: "sidebar-search",
      shortcut,
    },
    ...(controls.aiAvailable
      ? [
          {
            mode: "AI" as const,
            Icon: Sparkles,
            label: t("aiTrigger"),
            accessibleLabel: t("aiTriggerLabel"),
            testId: "sidebar-ai-search",
          },
        ]
      : []),
  ];
  return (
    <SidebarMenu className="gap-1 pt-2">
      {triggers.map(
        ({ mode, Icon, label, accessibleLabel, testId, shortcut }) => (
          <SidebarMenuItem key={mode}>
            <SidebarMenuButton
              type="button"
              onClick={() => open(mode)}
              aria-label={accessibleLabel}
              aria-haspopup="dialog"
              {...(collapsed ? { tooltip: accessibleLabel } : {})}
              className={`min-h-touch border focus-field border-input bg-surface text-sm text-text group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:justify-center focus-visible:ring-0 dense:min-h-control ${collapsed ? "justify-center" : "px-3"}`}
              data-testid={testId}
            >
              <Icon aria-hidden="true" className="size-4 text-muted" />
              <span className={collapsed ? "sr-only" : "flex-1 truncate"}>
                {label}
              </span>
              {collapsed || shortcut === undefined ? null : (
                <kbd className="rounded border border-sidebar-border px-1.5 text-xs text-sidebar-foreground/70">
                  {shortcut}
                </kbd>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ),
      )}
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
