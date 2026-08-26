"use client";

import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { PrivateFileUpload } from "@/components/files/PrivateFileUpload";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { SelectControl } from "@/components/ui/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  attachTransportFileRef,
  authorizeTransportFileUploadRef,
  captureProofOfDeliveryRef,
  listShipmentsRef,
  recordFailedDeliveryRef,
  returnFailedShipmentToWarehouseRef,
  type ShipmentView,
} from "@/lib/convex/fulfillmentApi";
import { listLocationsRef, type LocationRow } from "@/lib/convex/masterDataApi";
import { newRequestId } from "@/lib/convex/writeState";
import {
  acceptedTypesFor,
  maximumInputBytesFor,
  optimizeUpload,
} from "@/lib/files/optimizeUpload";
import { useUploadThing } from "@/lib/uploadthing/client";

export function HandheldDelivery() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) =>
        preview ? (
          <DeliveryWorkspace
            warehouseId={warehouseId}
            preview
            shipments={[
              {
                found: true,
                shipmentId: "prv_shipment_1",
                shipmentNumber: "SHP-2608-001",
                fulfillmentOrderId: "prv_ff",
                warehouseId,
                status: "IN_TRANSIT",
                expectedPackageCount: 4,
                loadedPackageCount: 4,
                tripId: "prv_trip_1",
              },
            ]}
            returnLocations={[
              {
                locationId: "prv_return_dock",
                warehouseId,
                code: "RTN-DOCK",
                locationType: "DOCK",
                status: "ACTIVE",
              },
            ]}
          />
        ) : (
          <ServerDeliveryWorkspace warehouseId={warehouseId} />
        )
      }
    </QueryGate>
  );
}

function ServerDeliveryWorkspace({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const outcome = useQuery(listShipmentsRef, {
    warehouseId,
    maxPageSize: 100,
  });
  const locations = useQuery(listLocationsRef, {
    warehouseId,
    status: "ACTIVE",
    maxPageSize: 100,
  });
  if (outcome === undefined || locations === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok || !outcome.value.ok || !locations.ok || !locations.value.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  return (
    <DeliveryWorkspace
      warehouseId={warehouseId}
      shipments={outcome.value.items}
      returnLocations={locations.value.items}
    />
  );
}

function DeliveryWorkspace({
  warehouseId,
  shipments,
  returnLocations,
  preview = false,
}: {
  readonly warehouseId: string;
  readonly shipments: readonly ShipmentView[];
  readonly returnLocations: readonly LocationRow[];
  readonly preview?: boolean;
}) {
  const t = useTranslations("Transport");
  const active = shipments.filter(
    (shipment) =>
      ["IN_TRANSIT", "DELIVERY_FAILED"].includes(shipment.status ?? "") &&
      shipment.shipmentId !== undefined,
  );
  const [shipmentId, setShipmentId] = useState(active[0]?.shipmentId);
  const shipment = active.find((entry) => entry.shipmentId === shipmentId);
  if (shipmentId === undefined)
    return <Notice tone="muted" title={t("deliveryQueueEmpty")} />;
  return (
    <section aria-labelledby="delivery-title" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 text-sm font-semibold text-text">
        <label htmlFor="active-delivery-shipment">
          {t("deliveryShipment")}
        </label>
        <SelectControl
          id="active-delivery-shipment"
          value={shipmentId}
          onValueChange={setShipmentId}
          options={active.map((entry) => ({
            value: entry.shipmentId!,
            label: entry.shipmentNumber ?? entry.shipmentId!,
          }))}
          placeholder={t("deliveryShipment")}
          emptyLabel={t("deliveryQueueEmpty")}
          className="min-h-12 font-mono"
        />
      </div>
      <h2 id="delivery-title" className="text-xl font-semibold text-text">
        {shipment?.status === "DELIVERY_FAILED"
          ? t("returnTitle")
          : t("capturePod")}
      </h2>
      {shipment?.status === "DELIVERY_FAILED" ? (
        <EntityWriteForm
          presentation="inline"
          mutationRef={returnFailedShipmentToWarehouseRef}
          legend={t("returnTitle")}
          description={t("returnHelp")}
          submitLabel={t("returnToWarehouse")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "locationId",
              label: t("returnLocation"),
              kind: "select",
              required: true,
              options: returnLocations.map((location) => ({
                value: location.locationId,
                label: `${location.code} · ${location.locationType}`,
              })),
            },
            {
              name: "reason",
              label: t("returnReason"),
              kind: "text",
              required: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            shipmentId,
            returnLocationId: values["locationId"] ?? "",
            reason: values["reason"] ?? "",
          })}
        />
      ) : preview ? (
        <Notice
          tone="accent"
          title={t("podPreview")}
          body={t("podPreviewHelp")}
        />
      ) : (
        <LivePodCapture warehouseId={warehouseId} shipmentId={shipmentId} />
      )}
      {shipment?.status !== "IN_TRANSIT" ? null : (
        <EntityWriteForm
          presentation="inline"
          mutationRef={recordFailedDeliveryRef}
          legend={t("failedDeliveryTitle")}
          description={t("failedDeliveryHelp")}
          submitLabel={t("recordFailure")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "reason",
              label: t("failureReason"),
              kind: "text",
              required: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            shipmentId,
            reason: values["reason"] ?? "",
            capturedAt: Date.now(),
          })}
        />
      )}
    </section>
  );
}

function LivePodCapture({
  warehouseId,
  shipmentId,
}: {
  readonly warehouseId: string;
  readonly shipmentId: string;
}) {
  const t = useTranslations("Transport");
  const authorize = useMutation(authorizeTransportFileUploadRef);
  const attach = useMutation(attachTransportFileRef);
  const capture = useMutation(captureProofOfDeliveryRef);
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const { startUpload, isUploading } = useUploadThing("transportFile", {
    onUploadProgress: setProgress,
  });

  const upload = async () => {
    if (selected === null || recipient.trim().length === 0 || busy) return;
    setBusy(true);
    setProgress(0);
    setNotice(t("podUploading"));
    try {
      const prepared = await optimizeUpload(selected, "PHOTO");
      const authorization = await authorize({
        warehouseId,
        shipmentId,
        kind: "POD",
      });
      if (!authorization.ok || !("uploadGrantId" in authorization.value)) {
        throw new Error("AUTHORIZATION_REFUSED");
      }
      const uploads = await startUpload([prepared.file], {
        grantId: authorization.value.uploadGrantId,
        contentDigest: prepared.contentDigest,
      });
      const verified = uploads?.[0]?.serverData;
      if (verified === null || verified === undefined) {
        throw new Error("UPLOAD_NOT_VERIFIED");
      }
      const attached = await attach({
        requestId: newRequestId(),
        warehouseId,
        shipmentId,
        uploadGrantId: authorization.value.uploadGrantId,
        fileName: prepared.file.name,
        kind: "POD",
        contentType: verified.contentType,
        byteSize: verified.byteSize,
        contentDigest: verified.contentDigest,
        uploadThingKey: verified.providerKey,
      });
      if (!attached.ok || !attached.value.written) {
        throw new Error("ATTACH_REFUSED");
      }
      const captured = await capture({
        requestId: newRequestId(),
        warehouseId,
        shipmentId,
        transportFileId: attached.value.documentId,
        recipientName: recipient.trim(),
        ...(note.trim().length === 0 ? {} : { recipientNote: note.trim() }),
        capturedAt: Date.now(),
      });
      if (!captured.ok || !captured.value.written) {
        throw new Error("CAPTURE_REFUSED");
      }
      setNotice(t("podCaptured"));
      setSelected(null);
      setRecipient("");
      setNote("");
      setResetKey((value) => value + 1);
    } catch {
      setNotice(t("podFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="grid gap-4">
        <label className="text-sm font-semibold text-text">
          {t("recipientName")}
          <Input
            className="mt-2"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
          />
        </label>
        <label className="text-sm font-semibold text-text">
          {t("recipientNote")}
          <Input
            className="mt-2"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <PrivateFileUpload
          accept={acceptedTypesFor("PHOTO")}
          maxSize={maximumInputBytesFor("PHOTO")}
          disabled={busy || isUploading}
          resetKey={resetKey}
          labels={{
            drop: t("podDrop"),
            browse: t("podBrowse"),
            limit: t("podLimit"),
            remove: t("podRemove"),
            invalid: t("podInvalid"),
          }}
          onFileChange={setSelected}
        />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button
          type="button"
          disabled={
            busy ||
            isUploading ||
            selected === null ||
            recipient.trim().length === 0
          }
          onClick={() => void upload()}
        >
          {t("capturePod")}
        </Button>
        <span role="status" className="text-sm text-muted">
          {isUploading && progress > 0
            ? `${notice} ${Math.round(progress)}%`
            : notice}
        </span>
      </div>
    </div>
  );
}
