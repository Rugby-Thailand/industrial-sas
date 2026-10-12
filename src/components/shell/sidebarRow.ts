import { cn } from "@/lib/utils";

/**
 * Row geometry shared by every sidebar menu row: search, destinations and
 * submenu toggles. Rows centre on the icon rail and pad when expanded.
 */
export function sidebarRowClassName(
  collapsed: boolean,
  ...extra: Parameters<typeof cn>
): string {
  return cn(
    "min-h-touch gap-3 rounded-lg text-sm font-normal group-data-[collapsible=icon]:justify-center dense:min-h-11 [&>svg]:size-[18px]",
    collapsed ? "justify-center" : "px-3",
    ...extra,
  );
}
