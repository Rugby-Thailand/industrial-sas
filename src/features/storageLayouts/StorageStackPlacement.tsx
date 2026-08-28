"use client";

import { useMutation, useQuery } from "convex/react";
import { QrCode } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listHandlingUnitsRef,
  type HandlingUnitRow,
} from "@/lib/convex/masterDataApi";
import {
  storageLayoutRefs,
  type StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";

const metres = (millimetres: number) => millimetres / 1_000;
const millimetres = (value: string) => Math.round(Number(value) * 1_000);

export function StorageStackPlacementWorkbench() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => <OperationalStorageStacks warehouseId={warehouseId} />}
    </QueryGate>
  );
}

function OperationalStorageStacks({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const t = useTranslations("StorageLayouts");
  const outcome = useQuery(storageLayoutRefs.listOperationalZones, {
    warehouseId,
  });
  if (outcome === undefined) {
    return (
      <div className="min-h-48 animate-pulse rounded-2xl border border-border bg-surface" />
    );
  }
  if (!outcome.ok) {
    return <Notice tone="warning" title={t("loadError")} />;
  }
  const zones: readonly StorageZoneRow[] = Array.isArray(outcome.value)
    ? outcome.value
    : [];
  if (zones.length === 0) {
    return (
      <Notice
        tone="muted"
        title={t("noActiveStorageStacks")}
        body={t("noActiveStorageStacksHelp")}
      />
    );
  }
  return <StorageStackPlacementPanel warehouseId={warehouseId} zones={zones} />;
}

export function StorageStackPlacementPanel({
  warehouseId,
  zones,
}: {
  readonly warehouseId: string;
  readonly zones: readonly StorageZoneRow[];
}) {
  const t = useTranslations("StorageLayouts");
  const placeHandlingUnit = useMutation(storageLayoutRefs.placeHandlingUnit);
  const unitsOutcome = useQuery(listHandlingUnitsRef, {
    warehouseId,
    status: "ACTIVE",
    maxPageSize: 100,
  });
  const stackedHandlingUnitIds = new Set(
    zones.flatMap((zone) =>
      zone.placements.map((placement) => placement.handlingUnitId),
    ),
  );
  const units: readonly HandlingUnitRow[] =
    unitsOutcome?.ok === true && unitsOutcome.value.ok
      ? unitsOutcome.value.items.filter(
          (unit) => !stackedHandlingUnitIds.has(unit.handlingUnitId),
        )
      : [];
  const [lpn, setLpn] = useState("");
  const [zoneScan, setZoneScan] = useState("");
  const [unitWidth, setUnitWidth] = useState("1.2");
  const [unitDepth, setUnitDepth] = useState("1");
  const [unitHeight, setUnitHeight] = useState("1.4");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{
    readonly tone: "success" | "warning";
    readonly text: string;
  }>();

  const selectUnit = (nextLpn: string) => {
    setLpn(nextLpn);
    const unit = units.find(
      (candidate) => candidate.lpn.toUpperCase() === nextLpn.toUpperCase(),
    );
    if (unit?.widthMm !== undefined) setUnitWidth(String(metres(unit.widthMm)));
    if (unit?.depthMm !== undefined) setUnitDepth(String(metres(unit.depthMm)));
    if (unit?.heightMm !== undefined) {
      setUnitHeight(String(metres(unit.heightMm)));
    }
  };

  const placeUnit = async () => {
    setPending(true);
    setMessage(undefined);
    try {
      const outcome = await placeHandlingUnit({
        warehouseId,
        requestId: crypto.randomUUID(),
        lpn,
        zoneScan,
        widthMm: millimetres(unitWidth),
        depthMm: millimetres(unitDepth),
        heightMm: millimetres(unitHeight),
      });
      if (!outcome.ok) {
        setMessage({
          tone: "warning",
          text: t("writeError", { code: outcome.denial.code }),
        });
      } else if (!outcome.value.written) {
        setMessage({
          tone: "warning",
          text: t("writeError", { code: outcome.value.error.code }),
        });
      } else {
        setMessage({
          tone: outcome.value.capacityWarning ? "warning" : "success",
          text: outcome.value.capacityWarning
            ? t("stackHeightWarning", { level: outcome.value.levelIndex })
            : t("unitPlaced", { level: outcome.value.levelIndex }),
        });
        setLpn("");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="rounded-2xl border border-accent/60 bg-accent-surface p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-raised text-accent">
          <QrCode className="size-5" />
        </div>
        <div>
          <h2 className="font-semibold text-text">{t("scanPlacement")}</h2>
          <p className="mt-1 text-sm text-muted">{t("scanPlacementHelp")}</p>
        </div>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
        {zones.map((zone) => (
          <Button
            key={zone.zoneId}
            type="button"
            size="sm"
            variant={zoneScan === zone.code ? "default" : "outline"}
            className="shrink-0"
            onClick={() => setZoneScan(zone.code)}
          >
            {zone.code} · {zone.label}
          </Button>
        ))}
      </div>

      <datalist id="operational-storage-handling-units">
        {units.map((unit) => (
          <option key={unit.handlingUnitId} value={unit.lpn} />
        ))}
      </datalist>
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <div className="md:col-span-2">
          <Label htmlFor="operational-stack-lpn">{t("handlingUnit")}</Label>
          <Input
            id="operational-stack-lpn"
            className="mt-2"
            list="operational-storage-handling-units"
            value={lpn}
            placeholder={t("scanLpn")}
            onChange={(event) => selectUnit(event.target.value)}
          />
        </div>
        <div className="md:col-span-3">
          <Label htmlFor="operational-stack-zone-scan">
            {t("zoneCodeOrQr")}
          </Label>
          <Input
            id="operational-stack-zone-scan"
            className="mt-2 font-mono"
            value={zoneScan}
            placeholder={t("scanZone")}
            onChange={(event) => setZoneScan(event.target.value)}
          />
        </div>
        {[
          ["unitWidth", unitWidth, setUnitWidth],
          ["unitDepth", unitDepth, setUnitDepth],
          ["unitHeight", unitHeight, setUnitHeight],
        ].map(([key, value, setValue]) => (
          <div key={String(key)}>
            <Label htmlFor={`operational-stack-${String(key)}`}>
              {t(key as "unitWidth" | "unitDepth" | "unitHeight")}
            </Label>
            <Input
              id={`operational-stack-${String(key)}`}
              className="mt-2"
              type="number"
              min="0.1"
              step="0.1"
              value={String(value)}
              onChange={(event) =>
                (setValue as (value: string) => void)(event.target.value)
              }
            />
          </div>
        ))}
        <div className="flex items-end md:col-span-2">
          <Button
            type="button"
            className="w-full"
            disabled={pending || lpn.trim() === "" || zoneScan.trim() === ""}
            onClick={placeUnit}
          >
            <QrCode className="size-4" />
            {pending ? t("placing") : t("confirmPlacement")}
          </Button>
        </div>
      </div>
      {message === undefined ? null : (
        <div className="mt-4">
          <Notice tone={message.tone} title={message.text} />
        </div>
      )}
    </section>
  );
}
