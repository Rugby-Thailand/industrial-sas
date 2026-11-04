import { cn } from "@/lib/utils";

/**
 * Row geometry shared by every sidebar menu row: search, destinations and
 * submenu toggles. Rows pad when expanded. On the icon rail each row is a
 * 48px square centred on the rail, like the warehouse button, so the current
 * destination's filled square lines up with every other icon.
 */
export function sidebarRowClassName(
  collapsed: boolean,
  ...extra: Parameters<typeof cn>
): string {
  return cn(
    "min-h-touch gap-3 rounded-lg text-sm font-normal group-data-[collapsible=icon]:justify-center dense:min-h-11 [&>svg]:size-[18px]",
    collapsed
      ? "justify-center group-data-[collapsible=icon]:size-12!"
      : "px-3",
    ...extra,
  );
}
