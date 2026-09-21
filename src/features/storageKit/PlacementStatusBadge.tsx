"use client";

import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type { StorageStackPlacementRow } from "@/lib/convex/storageLayoutApi";
import { placementStatusKey } from "@/lib/storageLayouts/storageKit";

export function placementStatusTone(
  placement: Pick<
    StorageStackPlacementRow,
    "moveRole" | "moveState" | "status"
  >,
): BadgeTone {
  const key = placementStatusKey(placement);
  return key === "placementStored"
    ? "success"
    : key === "placementReserved"
      ? "warning"
      : "pending";
}

export function PlacementStatusBadge({
  placement,
  label,
}: {
  readonly placement: Pick<
    StorageStackPlacementRow,
    "moveRole" | "moveState" | "status"
  >;
  readonly label: string;
}) {
  return <StatusBadge tone={placementStatusTone(placement)} label={label} />;
}
