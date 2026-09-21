"use client";

import { useMutation, useQuery } from "convex/react";
import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import AnimatedToggle from "@/components/ui/animated-toggle";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StatusReason } from "@/components/ui/StatusReason";
import { storageReviewPath } from "@/lib/navigation";
import {
  storageLayoutRefs,
  type StorageLayoutStatus,
} from "@/lib/convex/storageLayoutApi";

const setupErrors = new Set([
  "STORAGE_STACK_REQUIRED",
  "RESERVED_BLOCK_COLOR_INVALID",
  "FLOOR_COUNT_INVALID",
  "FLOOR_SEQUENCE_INVALID",
  "DIMENSION_INVALID",
  "FLOOR_PLACEMENT_INVALID",
  "FLOOR_OUT_OF_BOUNDS",
  "RESERVED_BLOCK_COUNT_INVALID",
  "RESERVED_BLOCK_INVALID",
  "RESERVED_BLOCK_OUT_OF_BOUNDS",
  "RESERVED_BLOCKS_OVERLAP",
  "ZONE_DIMENSION_INVALID",
  "ZONE_OUT_OF_BOUNDS",
  "ZONE_OVERLAPS_RESERVED_SPACE",
  "ZONE_OVERLAPS_STORAGE_ZONE",
  "HANDLING_UNIT_DOES_NOT_FIT",
  "STACK_SEQUENCE_INVALID",
]);

export function BuildingStatusToggle({
  warehouseId,
  buildingId,
  code,
  status,
}: {
  readonly warehouseId: string;
  readonly buildingId: string;
  readonly code: string;
  readonly status: StorageLayoutStatus;
}) {
  const t = useTranslations("StorageLayouts");
  const workspace = useWorkspace();
  const canChange =
    workspace.permissionsReady &&
    workspace.navigationPermissions.includes(
      "masterData.storageLayout.activate",
    );
  const result = useQuery(
    storageLayoutRefs.statusControl,
    canChange && status !== "ARCHIVED" ? { warehouseId, buildingId } : "skip",
  );
  const activate = useMutation(storageLayoutRefs.activate);
  const returnToDraft = useMutation(storageLayoutRefs.returnToDraft);
  const operation = useAsyncOperation({
    scope: `storage-status:${warehouseId}:${buildingId}`,
    describeError: (code) => code || "NETWORK_ERROR",
  });
  const [error, setError] = useState<{
    code: string;
    buildingId: string;
    warehouseId: string;
    version: number;
    status: StorageLayoutStatus;
    denied: boolean;
  }>();
  const control = result?.ok ? result.value : undefined;
  const current = control?.status ?? status;
  const active = current === "ACTIVE";
  const label = t(
    current === "ARCHIVED" ? "archived" : active ? "active" : "draft",
  );

  async function change() {
    if (!control || control.blocked || operation.busy) return;
    setError(undefined);
    const version = control.version;
    const status = current;
    const requestKey = `${active ? "draft" : "activate"}:${version}`;
    const result = await operation.run(async () => {
      try {
        const outcome = await (active ? returnToDraft : activate)({
          warehouseId,
          buildingId,
          expectedVersion: version,
          requestId: operation.request(requestKey),
        });
        if (!outcome.ok) {
          setError({
            buildingId,
            warehouseId,
            code: outcome.denial.code,
            version,
            status,
            denied: true,
          });
          return false;
        }
        if (!outcome.value.written) {
          setError({
            buildingId,
            warehouseId,
            code: outcome.value.error.code,
            version,
            status,
            denied: false,
          });
          return false;
        }
        operation.clearRequests();
        return true;
      } catch {
        setError({
          buildingId,
          warehouseId,
          code: "NETWORK_ERROR",
          version,
          status,
          denied: false,
        });
        throw new Error("NETWORK_ERROR");
      }
    });
    return result;
  }

  if (!canChange || current === "ARCHIVED")
    return (
      <StatusBadge
        tone={active ? "success" : current === "DRAFT" ? "pending" : "muted"}
        label={label}
      />
    );
  // A newer authoritative status makes the previous attempt's error obsolete.
  const failure =
    error?.buildingId === buildingId &&
    error?.warehouseId === warehouseId &&
    error?.version === control?.version &&
    error?.status === current
      ? error
      : undefined;
  const setupFailure =
    failure && !failure.denied && !active && setupErrors.has(failure.code);
  const message = failure
    ? t(
        failure.denied
          ? "statusAccessError"
          : failure.code === "LOCATION_OCCUPIED"
            ? "statusOccupied"
            : failure.code === "VERSION_CONFLICT"
              ? "layoutChangedRetry"
              : failure.code === "NETWORK_ERROR"
                ? "statusNetworkError"
                : setupFailure
                  ? "statusSetupError"
                  : "statusChangeFailed",
      )
    : control?.blocked
      ? t("statusOccupied")
      : result !== undefined && !control
        ? t("statusUnavailable")
        : undefined;
  return (
    <div
      className="relative z-10 flex min-h-touch items-center gap-2"
      aria-busy={operation.busy}
    >
      <AnimatedToggle
        checked={active}
        onChange={() => void change()}
        disabled={operation.busy || !control || control.blocked}
        label={t("statusToggleLabel", { code })}
        size="md"
      />
      <span className="text-xs font-medium">{label}</span>
      <span className="flex size-12 shrink-0 items-center justify-center">
        {operation.busy || result === undefined ? (
          <span role="status">
            <LoaderCircle
              className="size-4 animate-spin text-muted"
              aria-hidden="true"
            />
            <span className="sr-only">
              {t(operation.busy ? "statusSaving" : "statusLoading")}
            </span>
          </span>
        ) : message ? (
          <StatusReason
            key={failure ? `error-${failure.code}` : "blocked"}
            label={
              setupFailure
                ? `${t("statusReviewSetup")} · ${code}`
                : t(failure ? "statusErrorLabel" : "statusReasonLabel", {
                    code,
                  })
            }
            message={message}
            tone={failure || !control ? "error" : "locked"}
            href={setupFailure ? storageReviewPath(buildingId) : undefined}
            announce={!!failure}
          />
        ) : null}
      </span>
    </div>
  );
}
