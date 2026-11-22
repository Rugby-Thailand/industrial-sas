"use client";

import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useSidebar } from "@/components/ui/sidebar";

export const PRIMARY_NAV_ID = "primary-navigation";

/** Open the real shell menu and transfer keyboard focus into its first module. */
export function useOpenAllMenus(): () => void {
  const { isMobile, setOpen, setOpenMobile } = useSidebar();
  return useCallback(() => {
    flushSync(() => {
      if (isMobile) setOpenMobile(true);
      else setOpen(true);
    });
    const nav = document.getElementById(PRIMARY_NAV_ID);
    if (!nav) return;
    const target =
      nav.querySelector<HTMLElement>(
        "[data-module-menu] a[href]:not([hidden] *), [data-module-menu] button[aria-expanded]:not([hidden] *)",
      ) ??
      nav.querySelector<HTMLElement>("a[href]") ??
      nav
        .closest('[data-sidebar="sidebar"]')
        ?.querySelector<HTMLElement>('[data-slot="sidebar-trigger"]') ??
      nav;
    target.focus();
  }, [isMobile, setOpen, setOpenMobile]);
}
