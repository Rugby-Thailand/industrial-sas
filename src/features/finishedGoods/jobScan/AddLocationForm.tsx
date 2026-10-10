"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/ui/SelectControl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/navigation";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { useOperation, written } from "../shared";
import type { PickedLocation } from "./ticketDraft";

export function AddLocationForm({
  warehouseId,
  initialCode,
  onPick,
  onCancel,
}: {
  warehouseId: string;
  initialCode: string;
  onPick: (location: PickedLocation) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("JobScan");
  const id = useId();
  const convex = useConvex();
  const create = useMutation(fgRefs.createJobScanLocation);
  const outcome = useQuery(fgRefs.jobScanLocationOptions, { warehouseId });
  const operation = useOperation(`add-location:${warehouseId}`);
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [floorId, setFloorId] = useState("");
  const existing = useQuery(
    fgRefs.resolveJobScanLocation,
    operation.errorCode === "DUPLICATE_KEY" ? { warehouseId, code } : "skip",
  );
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const buildings = outcome?.ok ? outcome.value.buildings : undefined;
  const floors =
    buildings?.find((building) => building.id === buildingId)?.floors ?? [];
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!buildingId || !code.trim()) return;
    const payload = {
      warehouseId,
      code,
      name,
      buildingId,
      ...(floorId ? { floorId } : {}),
    };
    await operation.run(async () => {
      written(
        await create({
          ...payload,
          requestId: operation.request(JSON.stringify(payload)),
        }),
      );
      const result = await convex.query(fgRefs.resolveJobScanLocation, {
        warehouseId,
        code,
      });
      if (!result.ok || !result.value.ok)
        throw new Error("LOCATION_UNAVAILABLE");
      if (alive.current)
        onPick({ ...result.value.location, text: result.value.location.code });
    });
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-border bg-raised p-4"
      aria-labelledby={`${id}-heading`}
    >
      <div className="space-y-1">
        <h3 id={`${id}-heading`} className="font-semibold">
          {t("addLocation")}
        </h3>
        <p className="text-sm text-muted">{t("addLocationHint")}</p>
      </div>
      <fieldset
        disabled={operation.busy}
        className="grid min-w-0 gap-3 sm:grid-cols-2"
      >
        <FormField id={`${id}-code`} label={t("locationCode")} required>
          {(control) => (
            <Input
              {...control}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={200}
              required
              autoComplete="off"
              autoFocus
            />
          )}
        </FormField>
        <FormField
          id={`${id}-name`}
          label={t("locationDisplayName")}
          hint={t("nameDefaultsToCode")}
        >
          {(control) => (
            <Input
              {...control}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              autoComplete="off"
            />
          )}
        </FormField>
        <FormField id={`${id}-building`} label={t("building")} required>
          {(control) => (
            <SelectControl
              {...control}
              value={buildingId}
              options={(buildings ?? []).map((building) => ({
                value: building.id,
                label: `${building.code} · ${building.name}`,
              }))}
              onValueChange={(value) => {
                setBuildingId(value);
                setFloorId("");
              }}
              required
              pending={outcome === undefined}
              placeholder={t("chooseBuilding")}
              emptyLabel={t("noActiveBuildings")}
            />
          )}
        </FormField>
        <FormField id={`${id}-floor`} label={t("floorOptional")}>
          {(control) => (
            <SelectControl
              {...control}
              value={floorId}
              options={[
                { value: "", label: t("noFloor") },
                ...floors.map((floor) => ({
                  value: floor.id,
                  label: t("floorNumber", { number: floor.number }),
                })),
              ]}
              onValueChange={setFloorId}
              disabled={!buildingId}
              placeholder={t("noFloor")}
              emptyLabel={t("noFloor")}
            />
          )}
        </FormField>
      </fieldset>
      {outcome && !outcome.ok && (
        <p role="alert" className="text-sm text-danger">
          {t("locationLookupDenied")}
        </p>
      )}
      {buildings?.length === 0 && (
        <p className="text-sm text-muted">
          {t("noActiveBuildings")}{" "}
          <Link
            href={`${ROUTES.storageLayouts}/new`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-link underline"
          >
            {t("setupBuilding")}
          </Link>
        </p>
      )}
      {operation.error && (
        <p role="alert" className="text-sm text-danger">
          {operation.error}
        </p>
      )}
      {existing?.ok && existing.value.ok && (
        <div className="space-y-2">
          <p className="text-sm text-muted">{t("existingLocationConflict")}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (existing.value.ok)
                onPick({
                  ...existing.value.location,
                  text: existing.value.location.code,
                });
            }}
          >
            {t("useExistingLocation")}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={operation.busy || !buildingId || !code.trim()}
        >
          {operation.busy ? t("creatingLocation") : t("createAndUseLocation")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
