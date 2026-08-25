"use client";

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
          // Base units are immutable because stored ledger quantities use them.
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

  if (gate.kind === "BACKEND_MISSING" || gate.kind === "SIGN_IN_REQUIRED") {
    return <LedgerPanelStatus state={{ kind: gate.kind }} />;
  }

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
