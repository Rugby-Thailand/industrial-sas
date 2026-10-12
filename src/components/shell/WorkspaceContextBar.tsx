"use client";

import { Warehouse as WarehouseIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { flushSync } from "react-dom";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { SelectControl } from "@/components/ui/SelectControl";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { warehouseLabel } from "@/lib/workspace/workspace";

const CONTEXT_SLOT = "workspace-context";

/**
 * Moves focus from the rail button, which unmounts as the sidebar expands, to
 * the warehouse selector it revealed (or the read-only warehouse).
 */
function focusExpandedWarehouse() {
  const context = document.querySelector<HTMLElement>(
    `[data-slot="${CONTEXT_SLOT}"]`,
  );
  (
    context?.querySelector<HTMLElement>('[data-slot="select-trigger"]') ??
    context
  )?.focus();
}

/**
 * The selected warehouse, as the second line of the sidebar's compact
 * identity. `switchable` pages (the top-level storage and finished-goods
 * pages) offer the warehouse selector; task and detail pages show the
 * selection read-only. A member without storage access sees nothing on
 * read-only pages. The collapsed rail shows one warehouse icon that expands
 * the sidebar and moves focus to the warehouse it reveals.
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

  const selectedLabel = selected ? warehouseLabel(selected) : undefined;

  if (collapsed) {
    const label =
      selectedLabel === undefined
        ? t("warehouse")
        : `${t("warehouse")}: ${selectedLabel}`;
    return (
      <SidebarMenu className="pt-2">
        <SidebarMenuItem>
          <SidebarMenuButton
            type="button"
            tooltip={label}
            aria-label={label}
            onClick={() => {
              flushSync(() => setOpen(true));
              focusExpandedWarehouse();
            }}
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
      tabIndex={-1}
      className="min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      data-slot={CONTEXT_SLOT}
      data-testid="sidebar-warehouse"
      {...(selectedLabel === undefined ? {} : { title: selectedLabel })}
    >
      <h2 id={`${warehouseId}-heading`} className="sr-only">
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
          {/*
           * No leading icon: beside the app mark and sidebar toggle, the
           * narrow identity column needs its width for the warehouse label.
           * The section title shows a truncated selection in full.
           */}
          <SelectControl
            id={warehouseId}
            value={workspace.selectedWarehouseId ?? ""}
            onValueChange={(warehouse) => workspace.selectWarehouse(warehouse)}
            placeholder={t("selectWarehouse")}
            emptyLabel={t("noWarehouses")}
            size="compact"
            className="w-full px-2 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"
            testId="warehouse-select"
            options={workspace.warehouses.map((warehouse) => ({
              value: warehouse.id,
              label: warehouseLabel(warehouse),
            }))}
          />
        </>
      ) : selected ? (
        <p className="truncate text-sm text-muted">
          <span className="block truncate">{selected.code}</span>
          <span className="sr-only">{selected.name}</span>
        </p>
      ) : null}
    </section>
  );
}
