"use client";

import {
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Eye,
  PackagePlus,
  PencilLine,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";
import type {
  StorageBuildingRow,
  StorageFloorRow,
} from "@/lib/convex/storageLayoutApi";
import { ROUTES } from "@/lib/navigation";

type StepState = "done" | "todo" | "notNeeded";

/** Business setup progress for one building, derived from saved data only. */
export function layoutChecklist(
  building: StorageBuildingRow,
  floors: readonly StorageFloorRow[],
): readonly { readonly key: string; readonly state: StepState }[] {
  const zones = floors.flatMap((floor) => floor.storageZones);
  const addressed = zones.filter((zone) => zone.mode !== "SIMPLE");
  return [
    { key: "building", state: "done" },
    { key: "floors", state: floors.length > 0 ? "done" : "todo" },
    { key: "spots", state: zones.length > 0 ? "done" : "todo" },
    {
      key: "positions",
      state:
        addressed.length === 0
          ? "notNeeded"
          : addressed.every((zone) =>
                zone.positions.some((position) => !position.isDefault),
              )
            ? "done"
            : "todo",
    },
    { key: "activate", state: building.status === "ACTIVE" ? "done" : "todo" },
  ];
}

/**
 * The building's three task intents (F28): find and view (read-only), store
 * goods (the existing Finished goods selection → Store flow; no unit is
 * implied here) and edit the layout (an explicit editor step). Help explains
 * the setup order and the two QR kinds.
 */
export function LayoutTaskBar({
  building,
  floors,
  editing,
  editable,
  pending,
  floorNumber,
  onView,
  onEdit,
}: {
  readonly building: StorageBuildingRow;
  readonly floors: readonly StorageFloorRow[];
  readonly editing: boolean;
  readonly editable: boolean;
  readonly pending: boolean;
  readonly floorNumber: number;
  readonly onView: () => void;
  readonly onEdit: () => void;
}) {
  const t = useTranslations("StorageLayouts");
  const active = building.status === "ACTIVE";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label={t("layoutActions.task.group")}
        className="flex flex-wrap gap-1 rounded-lg bg-raised p-1"
      >
        <Button
          type="button"
          size="sm"
          variant={editing ? "ghost" : "secondary"}
          aria-pressed={!editing}
          title={t("layoutActions.task.viewHint")}
          className="min-h-11"
          disabled={pending}
          onClick={() => {
            if (editing) onView();
          }}
        >
          <Eye aria-hidden="true" className="size-4" />
          {t("layoutActions.task.view")}
        </Button>
        {active ? (
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="min-h-11"
            title={t("layoutActions.task.storeHint")}
          >
            <Link
              href={ROUTES.finishedGoods}
              aria-describedby="layout-store-hint"
            >
              <PackagePlus aria-hidden="true" className="size-4" />
              {t("layoutActions.task.store")}
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-11"
            disabled
            aria-describedby="layout-store-hint"
          >
            <PackagePlus aria-hidden="true" className="size-4" />
            {t("layoutActions.task.store")}
          </Button>
        )}
        {editable ? (
          <Button
            type="button"
            size="sm"
            variant={editing ? "secondary" : "ghost"}
            aria-pressed={editing}
            title={t("layoutActions.task.editHint")}
            className="min-h-11"
            disabled={pending}
            onClick={() => {
              if (!editing) onEdit();
            }}
          >
            <PencilLine aria-hidden="true" className="size-4" />
            {t("editFloor", { floor: floorNumber })}
          </Button>
        ) : null}
      </div>
      <p id="layout-store-hint" className="text-xs text-muted">
        {editing
          ? t("layoutActions.task.editHint")
          : active
            ? t("layoutActions.task.storeHint")
            : t("layoutActions.task.storeInactive")}
      </p>
      <LayoutHelpDialog building={building} floors={floors} />
    </div>
  );
}

export function LayoutHelpDialog({
  building,
  floors,
}: {
  readonly building: StorageBuildingRow;
  readonly floors: readonly StorageFloorRow[];
}) {
  const t = useTranslations("StorageLayouts");
  const steps = layoutChecklist(building, floors);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="min-h-11">
          <CircleHelp aria-hidden="true" className="size-4" />
          {t("layoutActions.help.open")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("closeDialog")} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("layoutActions.help.title")}</DialogTitle>
          <DialogDescription>
            {t("layoutActions.help.description")}
          </DialogDescription>
        </DialogHeader>
        <section aria-labelledby="layout-help-checklist">
          <h3 id="layout-help-checklist" className="text-sm font-semibold">
            {t("layoutActions.help.checklist")}
          </h3>
          <ol className="mt-2 space-y-2 text-sm" data-testid="layout-checklist">
            {steps.map((step) => (
              <li key={step.key} className="flex items-start gap-2">
                {step.state === "done" ? (
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-success"
                  />
                ) : (
                  <CircleDashed
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted"
                  />
                )}
                <span>
                  {t(
                    `layoutActions.help.step.${step.key}` as Parameters<
                      typeof t
                    >[0],
                  )}
                  <span className="text-muted">
                    {" · "}
                    {t(
                      step.state === "done"
                        ? "layoutActions.help.done"
                        : step.state === "todo"
                          ? "layoutActions.help.todo"
                          : "layoutActions.help.notNeeded",
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <section className="space-y-1 text-sm">
          <h3 className="font-semibold">{t("layoutActions.help.qrTitle")}</h3>
          <p className="text-muted">{t("layoutActions.help.qrBody")}</p>
          <p className="text-muted">{t("layoutActions.vocab.body")}</p>
        </section>
      </DialogContent>
    </Dialog>
  );
}
