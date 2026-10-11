"use client";

import { Warehouse as WarehouseIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { SelectControl } from "@/components/ui/SelectControl";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { warehouseLabel } from "@/lib/workspace/workspace";

/**
 * The selected warehouse, in the sidebar rather than the page header.
 * `switchable` pages (the top-level storage and finished-goods pages) offer
 * the warehouse selector; task and detail pages show the selection read-only,
 * as before. A member without storage access sees nothing on read-only pages.
 * The collapsed rail shows one warehouse icon that opens the sidebar.
 */
export function WorkspaceContextBar({
  switchable,
  collapsed = false,
}: {
  readonly switchable: boolean;
  readonly collapsed?: boolean;
}) {
  const t = useTranslations("Workspace");
  const workspace = useWorkspace();
  const { setOpen } = useSidebar();
  const warehouseId = useId();
  const available =
    workspace.selectable && workspace.organization !== undefined;
  const selected = available
    ? workspace.warehouses.find(
        (warehouse) => warehouse.id === workspace.selectedWarehouseId,
      )
    : undefined;

  if (!switchable && !selected) return null;

  if (collapsed) {
    const label = selected
      ? `${t("warehouse")}: ${selected.code} · ${selected.name}`
      : t("warehouse");
    return (
      <SidebarMenu className="pt-2">
        <SidebarMenuItem>
          <SidebarMenuButton
            type="button"
            tooltip={label}
            aria-label={label}
            onClick={() => setOpen(true)}
            className="min-h-touch justify-center text-sidebar-foreground group-data-[collapsible=icon]:size-12!"
            data-testid="sidebar-warehouse-rail"
          >
            <WarehouseIcon aria-hidden="true" className="size-4" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <section
      aria-labelledby={`${warehouseId}-heading`}
      className="mt-2 rounded-md border border-sidebar-border px-3 py-2"
      data-testid="sidebar-warehouse"
    >
      <h2
        id={`${warehouseId}-heading`}
        className="flex items-center gap-1.5 text-xs font-medium text-sidebar-foreground/70"
      >
        <WarehouseIcon aria-hidden="true" className="size-3.5 shrink-0" />
        {t("warehouse")}
      </h2>
      {!available ? (
        <div className="mt-1 flex flex-col gap-0.5 text-xs">
          <span className="font-semibold text-text">{t("unavailable")}</span>
          <span className="text-muted">{t("unavailableHint")}</span>
        </div>
      ) : switchable ? (
        <>
          {/*
           * `htmlFor` rather than a wrapping `<label>`: the Radix trigger is a
           * `<button>`, which is a labelable element, but only an explicit
           * `for` reaches it.
           */}
          <label htmlFor={warehouseId} className="sr-only">
            {t("warehouse")}
          </label>
          <SelectControl
            id={warehouseId}
            value={workspace.selectedWarehouseId ?? ""}
            onValueChange={(warehouse) => workspace.selectWarehouse(warehouse)}
            placeholder={t("selectWarehouse")}
            emptyLabel={t("noWarehouses")}
            size="compact"
            className="mt-1 w-full [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"
            testId="warehouse-select"
            options={workspace.warehouses.map((warehouse) => ({
              value: warehouse.id,
              label: warehouseLabel(warehouse),
            }))}
          />
        </>
      ) : selected ? (
        <p
          className="mt-1 min-w-0 text-sm"
          title={`${selected.code} · ${selected.name}`}
        >
          <span className="block truncate font-semibold text-text">
            {selected.code}
          </span>
          <span className="block truncate text-xs text-muted">
            {selected.name}
          </span>
        </p>
      ) : null}
    </section>
  );
}
