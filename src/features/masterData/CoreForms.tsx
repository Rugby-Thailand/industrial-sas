"use client";

/**
 * The write controls for the entities that already had read screens.
 *
 * Items and locations were listed but not maintainable, which is a half-built
 * state a screen should not stay in: an administrator who can see the register
 * and cannot add to it has to be told where to go instead, and there was nowhere
 * to send them.
 *
 * The location form is the one with a real precondition. A location belongs to a
 * site, so the form needs a selected warehouse and says so when there is none —
 * rather than defaulting to the first warehouse in the list, which is how a bin
 * gets created at the wrong plant.
 */
import { useTranslations } from "next-intl";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { resolveWriteGate } from "@/lib/convex/writeState";
import {
  createItemRef,
  createLocationRef,
  updateItemRef,
  type ItemRow,
} from "@/lib/convex/masterDataApi";

import { EntityWriteForm } from "./EntityWriteForm";
import { useSelectedWarehouseId } from "./EntityPanels";

/** The tracking modes an item may declare, in the order the schema lists them. */
const TRACKING_MODES = ["NONE", "LOT", "LOT_SERIAL"] as const;

export function ItemForm() {
  const t = useTranslations("MasterData");
  const writeT = useTranslations("Write");
  const trackingT = useTranslations("TrackingMode");

  return (
    <EntityWriteForm
      testId="form-item"
      mutationRef={createItemRef}
      legend={t("itemFormLegend")}
      description={t("itemFormDescription")}
      submitLabel={t("itemFormSubmit")}
      requiredMessage={writeT("required")}
      fields={[
        {
          name: "sku",
          label: t("columnSku"),
          kind: "text",
          required: true,
          monospace: true,
          hint: t("codeHint"),
        },
        { name: "name", label: t("columnName"), kind: "text", required: true },
        {
          name: "baseUom",
          label: t("columnBaseUom"),
          kind: "text",
          required: true,
          monospace: true,
          /*
           * The base unit is fixed at creation and cannot be changed later:
           * every quantity ever posted for the item is stored in it
           * (`ADR-0004`), so changing it would silently reinterpret history.
           */
          hint: t("baseUomHint"),
        },
        {
          name: "trackingMode",
          label: t("columnTrackingMode"),
          kind: "select",
          required: true,
          placeholder: t("selectTrackingMode"),
          options: TRACKING_MODES.map((mode) => ({
            value: mode,
            label: trackingT(mode),
          })),
          hint: t("trackingModeHint"),
        },
      ]}
      toArgs={(values, requestId) => ({
        requestId,
        sku: values["sku"] ?? "",
        name: values["name"] ?? "",
        baseUom: values["baseUom"] ?? "",
        trackingMode: (values["trackingMode"] ?? "NONE") as
          "NONE" | "LOT" | "LOT_SERIAL",
      })}
    />
  );
}

/**
 * Edit an item's name and tracking mode.
 *
 * SKU and base UOM are absent because the mutation does not accept them. A SKU
 * is the tenant's identifier for the thing, and the base unit is what every
 * posted quantity is denominated in; both are decisions, and a form that offered
 * them would be offering to rewrite history.
 */
export function ItemEditForm({ item }: { readonly item: ItemRow }) {
  const t = useTranslations("MasterData");
  const writeT = useTranslations("Write");
  const trackingT = useTranslations("TrackingMode");

  return (
    <EntityWriteForm
      testId="form-item-edit"
      mutationRef={updateItemRef}
      legend={t("itemEditLegend")}
      description={t("itemEditDescription")}
      submitLabel={t("itemEditSubmit")}
      requiredMessage={writeT("required")}
      fields={[
        {
          name: "name",
          label: t("columnName"),
          kind: "text",
          required: true,
          initialValue: item.name,
        },
        {
          name: "trackingMode",
          label: t("columnTrackingMode"),
          kind: "select",
          required: true,
          placeholder: t("selectTrackingMode"),
          initialValue: item.trackingMode,
          options: TRACKING_MODES.map((mode) => ({
            value: mode,
            label: trackingT(mode),
          })),
        },
      ]}
      toArgs={(values, requestId) => ({
        requestId,
        itemId: item.itemId,
        name: values["name"] ?? "",
        trackingMode: (values["trackingMode"] ?? item.trackingMode) as
          "NONE" | "LOT" | "LOT_SERIAL",
      })}
    />
  );
}

/** The location types the schema accepts, in its own order. */
const LOCATION_TYPES = [
  "DOCK",
  "STAGING",
  "RACK_BIN",
  "FLOOR_BLOCK",
  "QUARANTINE",
  "OVERFLOW",
] as const;

export function LocationForm() {
  const t = useTranslations("MasterData");
  const writeT = useTranslations("Write");
  const typeT = useTranslations("LocationType");
  const warehouseId = useSelectedWarehouseId();
  const gate = resolveWriteGate(useAppEnvironment());

  /*
   * The configuration gate is checked **before** the warehouse, and the order is
   * the whole point. On a machine with no deployment there are no warehouses to
   * select, so blaming the selection would make one screen give two different
   * reasons for one cause — and send an administrator looking for a warehouse
   * picker instead of an environment variable.
   */
  if (gate.kind === "BACKEND_MISSING" || gate.kind === "SIGN_IN_REQUIRED") {
    return <LedgerPanelStatus state={{ kind: gate.kind }} />;
  }

  // No site, no bin. Defaulting to "the first warehouse" is how stock ends up
  // at the wrong plant with nothing in the record to explain it.
  if (warehouseId === undefined) {
    return <LedgerPanelStatus state={{ kind: "WAREHOUSE_MISSING" }} />;
  }

  return (
    <EntityWriteForm
      testId="form-location"
      mutationRef={createLocationRef}
      legend={t("locationFormLegend")}
      description={t("locationFormDescription")}
      submitLabel={t("locationFormSubmit")}
      requiredMessage={writeT("required")}
      fields={[
        {
          name: "code",
          label: t("columnLocationCode"),
          kind: "text",
          required: true,
          monospace: true,
          hint: t("codeHint"),
        },
        {
          name: "locationType",
          label: t("columnLocationType"),
          kind: "select",
          required: true,
          placeholder: t("selectLocationType"),
          options: LOCATION_TYPES.map((type) => ({
            value: type,
            label: typeT(type),
          })),
        },
      ]}
      toArgs={(values, requestId) => ({
        requestId,
        warehouseId,
        code: values["code"] ?? "",
        locationType: values["locationType"] ?? "RACK_BIN",
      })}
    />
  );
}
