"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  assignShipmentToTripRef,
  createTripRef,
  listShipmentsRef,
  listTripsRef,
  releaseTripRef,
  type ShipmentView,
  type TripView,
} from "@/lib/convex/fulfillmentApi";

const savedId = (outcome: Record<string, unknown>) => {
  const value = outcome["value"] as Record<string, unknown> | undefined;
  return typeof value?.["documentId"] === "string"
    ? value["documentId"]
    : undefined;
};

export function TransportBoard() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) =>
        preview ? (
          <TransportWorkspace
            warehouseId={warehouseId}
            preview
            shipments={[
              {
                found: true,
                shipmentId: "prv_shipment_1",
                shipmentNumber: "SHP-2608-001",
                fulfillmentOrderId: "prv_ff_1",
                warehouseId,
                status: "READY_TO_LOAD",
                expectedPackageCount: 4,
                loadedPackageCount: 0,
              },
            ]}
            trips={[
              {
                found: true,
                tripId: "prv_trip_1",
                tripNumber: "TRIP-2608-001",
                warehouseId,
                status: "DRAFT",
                vehicleRegistration: "70-1234",
                driverName: "สมชาย",
                expectedShipmentCount: 0,
                expectedPackageCount: 0,
                loadedPackageCount: 0,
              },
            ]}
          />
        ) : (
          <ServerTransportBoard warehouseId={warehouseId} />
        )
      }
    </QueryGate>
  );
}

function ServerTransportBoard({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const shipments = useQuery(listShipmentsRef, {
    warehouseId,
    maxPageSize: 100,
  });
  const trips = useQuery(listTripsRef, { warehouseId, maxPageSize: 100 });
  if (shipments === undefined || trips === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!shipments.ok || !trips.ok || !shipments.value.ok || !trips.value.ok)
    return (
      <LedgerPanelStatus
        state={{
          kind: "DENIED",
          requestId: !shipments.ok
            ? shipments.requestId
            : !trips.ok
              ? trips.requestId
              : "",
        }}
      />
    );
  return (
    <TransportWorkspace
      warehouseId={warehouseId}
      shipments={shipments.value.items}
      trips={trips.value.items}
      incomplete={!shipments.value.complete || !trips.value.complete}
    />
  );
}

function TransportWorkspace({
  warehouseId,
  shipments,
  trips,
  preview = false,
  incomplete = false,
}: {
  readonly warehouseId: string;
  readonly shipments: readonly ShipmentView[];
  readonly trips: readonly TripView[];
  readonly preview?: boolean;
  readonly incomplete?: boolean;
}) {
  const t = useTranslations("Transport");
  const [createdTripId, setCreatedTripId] = useState<string>();
  const draftTrips = trips.filter(
    (trip) => trip.status === "DRAFT" && trip.tripId !== undefined,
  );
  const readyShipments = shipments.filter(
    (shipment) =>
      shipment.status === "READY_TO_LOAD" &&
      shipment.shipmentId !== undefined &&
      shipment.tripId === undefined,
  );
  const activeTripId = createdTripId ?? draftTrips[0]?.tripId;
  return (
    <div className="flex flex-col gap-6">
      {preview ? <Notice tone="accent" title={t("previewOnly")} /> : null}
      {incomplete ? <Notice tone="warning" title={t("moreRecords")} /> : null}
      <section
        aria-labelledby="transport-overview"
        className="grid gap-4 lg:grid-cols-2"
      >
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2
            id="transport-overview"
            className="text-lg font-semibold text-text"
          >
            {t("shipments")}
          </h2>
          <div className="mt-3 flex flex-col gap-2">
            {shipments.length === 0 ? (
              <Notice tone="muted" title={t("noShipments")} />
            ) : (
              shipments.map((shipment) => (
                <div
                  key={shipment.shipmentId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <span>
                    <span className="block font-mono text-sm font-semibold text-text">
                      {shipment.shipmentNumber}
                    </span>
                    <span className="text-xs text-muted">
                      {shipment.loadedPackageCount}/
                      {shipment.expectedPackageCount} {t("packages")}
                    </span>
                  </span>
                  <StatusBadge
                    tone={
                      shipment.status === "DELIVERED" ? "success" : "pending"
                    }
                    label={shipment.status ?? "UNKNOWN"}
                  />
                </div>
              ))
            )}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-lg font-semibold text-text">{t("trips")}</h2>
          <div className="mt-3 flex flex-col gap-2">
            {trips.length === 0 ? (
              <Notice tone="muted" title={t("noTrips")} />
            ) : (
              trips.map((trip) => (
                <div
                  key={trip.tripId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <span>
                    <span className="block font-mono text-sm font-semibold text-text">
                      {trip.tripNumber}
                    </span>
                    <span className="text-xs text-muted">
                      {trip.vehicleRegistration} · {trip.driverName}
                    </span>
                  </span>
                  <StatusBadge
                    tone={trip.status === "COMPLETE" ? "success" : "accent"}
                    label={trip.status ?? "UNKNOWN"}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </section>
      <section
        aria-labelledby="trip-plan"
        className="grid gap-5 lg:grid-cols-3"
      >
        <EntityWriteForm
          mutationRef={createTripRef}
          legend={t("createTrip")}
          submitLabel={t("createTrip")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "tripNumber",
              label: t("tripNumber"),
              kind: "text",
              required: true,
              initialValue: "TRIP-",
            },
            {
              name: "vehicle",
              label: t("vehicle"),
              kind: "text",
              required: true,
            },
            {
              name: "driver",
              label: t("driver"),
              kind: "text",
              required: true,
            },
            {
              name: "phone",
              label: t("driverPhone"),
              kind: "text",
              required: false,
              // Optional contact detail; the trip itself needs only the three
              // identities above.
              importance: "secondary",
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            tripNumber: values["tripNumber"] ?? "",
            vehicleRegistration: values["vehicle"] ?? "",
            driverName: values["driver"] ?? "",
            ...(values["phone"] ? { driverPhone: values["phone"] } : {}),
          })}
          onSaved={(outcome) => setCreatedTripId(savedId(outcome))}
        />
        {activeTripId === undefined || readyShipments.length === 0 ? (
          <Notice tone="muted" title={t("assignUnavailable")} />
        ) : (
          <EntityWriteForm
            mutationRef={assignShipmentToTripRef}
            legend={t("assignShipment")}
            submitLabel={t("assignShipment")}
            requiredMessage={t("required")}
            fields={[
              {
                name: "shipmentId",
                label: t("shipment"),
                kind: "select",
                required: true,
                options: readyShipments.map((shipment) => ({
                  value: shipment.shipmentId!,
                  label: shipment.shipmentNumber ?? shipment.shipmentId!,
                })),
              },
            ]}
            toArgs={(values, requestId) => ({
              requestId,
              warehouseId,
              tripId: activeTripId,
              shipmentId: values["shipmentId"] ?? "",
            })}
          />
        )}
        {activeTripId === undefined ? (
          <Notice tone="muted" title={t("releaseUnavailable")} />
        ) : (
          <EntityWriteForm
            mutationRef={releaseTripRef}
            legend={t("releaseTrip")}
            description={t("releaseTripHelp")}
            submitLabel={t("releaseTrip")}
            requiredMessage={t("required")}
            fields={[]}
            toArgs={(_values, requestId) => ({
              requestId,
              warehouseId,
              tripId: activeTripId,
            })}
          />
        )}
      </section>
    </div>
  );
}
