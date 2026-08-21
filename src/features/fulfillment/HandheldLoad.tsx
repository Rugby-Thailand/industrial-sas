"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { SelectControl } from "@/components/ui/SelectControl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  departTripRef,
  gateOutRef,
  listTripsRef,
  scanPackageLoadedRef,
  sealTripRef,
  startTripLoadingRef,
  type TripView,
} from "@/lib/convex/fulfillmentApi";

export function HandheldLoad() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) =>
        preview ? (
          <LoadWorkspace
            warehouseId={warehouseId}
            trips={[
              {
                found: true,
                tripId: "prv_trip_1",
                tripNumber: "TRIP-2608-001",
                warehouseId,
                status: "LOADING",
                vehicleRegistration: "70-1234",
                driverName: "สมชาย",
                expectedShipmentCount: 1,
                expectedPackageCount: 4,
                loadedPackageCount: 2,
              },
            ]}
            preview
          />
        ) : (
          <ServerLoadWorkspace warehouseId={warehouseId} />
        )
      }
    </QueryGate>
  );
}

function ServerLoadWorkspace({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const outcome = useQuery(listTripsRef, { warehouseId, maxPageSize: 100 });
  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok || !outcome.value.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  return (
    <LoadWorkspace warehouseId={warehouseId} trips={outcome.value.items} />
  );
}

function LoadWorkspace({
  warehouseId,
  trips,
  preview = false,
}: {
  readonly warehouseId: string;
  readonly trips: readonly TripView[];
  readonly preview?: boolean;
}) {
  const t = useTranslations("Transport");
  const actionable = trips.filter(
    (trip) =>
      ["READY_TO_LOAD", "LOADING", "SEALED", "GATED_OUT"].includes(
        trip.status ?? "",
      ) && trip.tripId !== undefined,
  );
  const [selectedId, setSelectedId] = useState(actionable[0]?.tripId);
  const trip = actionable.find((entry) => entry.tripId === selectedId);
  if (trip === undefined)
    return <Notice tone="muted" title={t("loadQueueEmpty")} />;
  return (
    <section aria-labelledby="load-title" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 text-sm font-semibold text-text">
        <label htmlFor="active-load-trip">{t("selectTrip")}</label>
        <SelectControl
          id="active-load-trip"
          value={selectedId ?? ""}
          onValueChange={setSelectedId}
          options={actionable.map((entry) => ({
            value: entry.tripId!,
            label: `${entry.tripNumber} · ${entry.vehicleRegistration}`,
          }))}
          placeholder={t("selectTrip")}
          emptyLabel={t("loadQueueEmpty")}
          className="min-h-12 font-mono"
        />
      </div>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="load-title"
              className="font-mono text-xl font-bold text-text"
            >
              {trip.tripNumber}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {trip.vehicleRegistration} · {trip.driverName}
            </p>
          </div>
          <StatusBadge tone="pending" label={trip.status ?? "UNKNOWN"} />
        </div>
        <p className="mt-5 text-4xl font-bold text-text">
          {trip.loadedPackageCount ?? 0}
          <span className="text-lg text-muted">
            {" "}
            / {trip.expectedPackageCount ?? 0}
          </span>
        </p>
        <p className="text-sm text-muted">{t("loadedProgress")}</p>
      </div>
      {preview ? <Notice tone="accent" title={t("previewOnly")} /> : null}
      <TripNextAction warehouseId={warehouseId} trip={trip} />
    </section>
  );
}

function TripNextAction({
  warehouseId,
  trip,
}: {
  readonly warehouseId: string;
  readonly trip: TripView;
}) {
  const t = useTranslations("Transport");
  const tripId = trip.tripId!;
  if (trip.status === "READY_TO_LOAD")
    return (
      <EntityWriteForm
        mutationRef={startTripLoadingRef}
        legend={t("startLoading")}
        description={t("startLoadingHelp")}
        submitLabel={t("startLoading")}
        requiredMessage={t("required")}
        fields={[]}
        toArgs={(_values, requestId) => ({ requestId, warehouseId, tripId })}
      />
    );
  if (trip.status === "LOADING")
    return (
      <div className="flex flex-col gap-5">
        <EntityWriteForm
          mutationRef={scanPackageLoadedRef}
          legend={t("scanPackage")}
          description={t("scanPackageHelp")}
          submitLabel={t("confirmLoad")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "packageNumber",
              label: t("packageNumber"),
              kind: "text",
              required: true,
              monospace: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            tripId,
            packageNumber: values["packageNumber"] ?? "",
          })}
        />
        <EntityWriteForm
          mutationRef={sealTripRef}
          legend={t("sealTrip")}
          description={t("sealHelp")}
          submitLabel={t("sealTrip")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "sealNumber",
              label: t("sealNumber"),
              kind: "text",
              required: true,
              monospace: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            tripId,
            sealNumber: values["sealNumber"] ?? "",
          })}
        />
      </div>
    );
  if (trip.status === "SEALED")
    return (
      <EntityWriteForm
        mutationRef={gateOutRef}
        legend={t("gateOut")}
        description={t("gateHelp")}
        submitLabel={t("gateOut")}
        requiredMessage={t("required")}
        fields={[
          {
            name: "gatePassNumber",
            label: t("gatePassNumber"),
            kind: "text",
            required: true,
            monospace: true,
          },
        ]}
        toArgs={(values, requestId) => ({
          requestId,
          warehouseId,
          tripId,
          gatePassNumber: values["gatePassNumber"] ?? "",
        })}
      />
    );
  return (
    <EntityWriteForm
      mutationRef={departTripRef}
      legend={t("depart")}
      description={t("departHelp")}
      submitLabel={t("depart")}
      requiredMessage={t("required")}
      fields={[]}
      toArgs={(_values, requestId) => ({ requestId, warehouseId, tripId })}
    />
  );
}
