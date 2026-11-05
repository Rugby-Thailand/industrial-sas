"use client";

import { Warehouse as WarehouseIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { flushSync } from "react-dom";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { useConnectionStall } from "@/components/system/connectionStall";
import { SelectControl } from "@/components/ui/SelectControl";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  warehouseLabel,
  type WarehouseOption,
} from "@/lib/workspace/workspace";

const CONTEXT_SLOT = "workspace-context";

/**
 * Moves focus from the rail button, which unmounts as the sidebar expands, to
 * the warehouse selector it revealed.
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
 * The warehouse this session works in. Undefined for HR-only members, an
 * organization without an open warehouse, or before one is chosen.
 */
function useSelectedWarehouse(): WarehouseOption | undefined {
  const workspace = useWorkspace();
  if (
    workspace.denied ||
    !workspace.selectable ||
    workspace.organization === undefined
  )
    return undefined;
  return workspace.warehouses.find(
    (warehouse) => warehouse.id === workspace.selectedWarehouseId,
  );
}

/**
 * The selected warehouse as a read-only line under the header's
 * organization name, whenever the sidebar's selector is out of sight: on a
 * phone, where it lives in the drawer, and beside the collapsed rail. The
 * code alone on a phone; the name joins it where there is room.
 */
export function HeaderWarehouse() {
  const navigation = useTranslations("Navigation");
  const { isMobile, state } = useSidebar();
  const selected = useSelectedWarehouse();
  if (selected === undefined || (!isMobile && state === "expanded"))
    return null;
  const label = warehouseLabel(selected);
  return (
    <p
      className="flex min-w-0 items-center gap-1 text-xs text-muted"
      title={label}
      data-testid="header-warehouse"
    >
      <WarehouseIcon aria-hidden="true" className="size-3 shrink-0" />
      <span className="sr-only">{`${navigation("currentWarehouse")}: ${label}`}</span>
      <span aria-hidden="true" className="truncate">
        {selected.code}
        <span className="hidden sm:inline">{` · ${selected.name}`}</span>
      </span>
    </p>
  );
}

/**
 * The warehouse this session works in, under its visible label ("Current
 * warehouse", distinct from the Warehouse module heading) in the sidebar
 * header. Every page offers the warehouse selector when storage access is
 * available. The collapsed rail shows one warehouse icon that expands the
 * sidebar and moves focus to the warehouse it reveals.
 */
export function WorkspaceContextBar({
  collapsed = false,
}: {
  readonly collapsed?: boolean;
}) {
  const t = useTranslations("Workspace");
  const app = useTranslations("App");
  const navigation = useTranslations("Navigation");
  // "Current warehouse", not the "Warehouse" module heading below it.
  const fieldLabel = navigation("currentWarehouse");
  const workspace = useWorkspace();
  const { setOpen } = useSidebar();
  const warehouseId = useId();
  // Loading behind a stalled connection waits quietly: the shell's notice
  // is the announcement.
  const stall = useConnectionStall();
  const waiting = workspace.loading && stall !== null;
  const available =
    workspace.selectable && workspace.organization !== undefined;
  const selected = useSelectedWarehouse();
  const selectedLabel = selected ? warehouseLabel(selected) : undefined;

  // HR-only members have organization context, but no warehouse access.
  if (workspace.denied) return null;

  if (collapsed) {
    const label =
      selectedLabel === undefined
        ? fieldLabel
        : `${fieldLabel}: ${selectedLabel}`;
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

  const labelId = `${warehouseId}-label`;
  const labelClassName = "mb-1 block text-xs text-muted";
  return (
    <section
      aria-labelledby={labelId}
      tabIndex={-1}
      className="min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      data-slot={CONTEXT_SLOT}
      data-testid="sidebar-warehouse"
      {...(selectedLabel === undefined ? {} : { title: selectedLabel })}
    >
      {!available ? (
        <>
          <p id={labelId} className={labelClassName}>
            {fieldLabel}
          </p>
          <div
            key={waiting ? "waiting" : "status"}
            className="flex flex-col gap-0.5 text-xs"
            {...(workspace.loading && !waiting ? { role: "status" } : {})}
          >
            {workspace.loading ? (
              <span className="text-muted">
                {waiting ? app("waitingForConnection") : t("loading")}
              </span>
            ) : workspace.organization !== undefined ? (
              // An organization member without an active warehouse they may open.
              <>
                <span className="font-semibold text-text">
                  {t("noWarehouses")}
                </span>
                <span className="text-muted">{t("noWarehousesHint")}</span>
              </>
            ) : (
              <>
                <span className="font-semibold text-text">
                  {t("unavailable")}
                </span>
                <span className="text-muted">{t("unavailableHint")}</span>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          {/*
           * `htmlFor` rather than a wrapping `<label>`: the Radix trigger is a
           * `<button>`, which is a labelable element, but only an explicit
           * `for` reaches it.
           */}
          <label id={labelId} htmlFor={warehouseId} className={labelClassName}>
            {fieldLabel}
          </label>
          {/* The section title shows a truncated selection in full. */}
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
      )}
    </section>
  );
}
