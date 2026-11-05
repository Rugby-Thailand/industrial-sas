"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { sidebarRowClassName } from "@/components/shell/sidebarRow";
import { Button } from "@/components/ui/button";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useMediaQuery } from "@/hooks/useMediaQuery";

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

/**
 * Search one tap away in the phone header; desktop keeps the sidebar entry.
 * The button takes focus before the dialog opens (iOS does not focus a
 * tapped button), so closing the dialog returns focus here.
 */
export function HeaderSearchTrigger() {
  const t = useTranslations("Search");
  const controls = useSearchControls();
  const { isMobile } = useSidebar();
  if (!isMobile || controls === null) return null;
  // Says what search finds, like the dialog's placeholder.
  const label = t(
    controls.canSearchPeople ? "triggerLabelPeople" : "triggerLabel",
  );
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-haspopup="dialog"
      title={label}
      onClick={(event) => {
        event.currentTarget.focus();
        controls.open("SEARCH");
      }}
      className="shrink-0 text-muted hover:text-text"
      data-testid="header-search"
    >
      <Search aria-hidden="true" className="size-[1.125rem]" />
    </Button>
  );
}

/** One sidebar entry for page, employee and AI search. */
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
  // The phone drawer and touch screens have no keyboard to press it with.
  const { isMobile } = useSidebar();
  const coarse = useMediaQuery("(pointer: coarse)");
  const showShortcut = !isMobile && !coarse;
  if (controls === null) return null;
  const open = onOpen ?? controls.open;
  // Says what search finds, like the dialog's placeholder.
  const people = controls.canSearchPeople;
  const label = t(people ? "triggerLabelPeople" : "triggerLabel");
  const searchLabel = showShortcut
    ? t("triggerShortcut", { label, shortcut })
    : label;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          type="button"
          onClick={() => open("SEARCH")}
          aria-label={searchLabel}
          aria-haspopup="dialog"
          {...(collapsed ? { tooltip: searchLabel } : {})}
          className={sidebarRowClassName(
            collapsed,
            "border border-sidebar-border/60 bg-raised text-muted",
          )}
          data-testid="sidebar-search"
        >
          <Search aria-hidden="true" className="size-4" />
          <span className={collapsed ? "sr-only" : "flex-1 truncate"}>
            {t(people ? "triggerPeople" : "trigger")}
          </span>
          {collapsed || !showShortcut ? null : (
            <kbd className="rounded border border-sidebar-border bg-sidebar-accent px-1.5 py-0.5 text-xs text-sidebar-accent-foreground">
              {shortcut}
            </kbd>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
