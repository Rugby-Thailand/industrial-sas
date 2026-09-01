"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Notice } from "@/components/ui/Notice";
import { WorkflowStageRail } from "@/components/workflow/WorkflowStageRail";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import type { PutawayTaskRow } from "@/lib/convex/inboundApi";
import { StorageStackPlacementWorkbench } from "@/features/storageLayouts/StorageStackPlacement";
import { ROUTES } from "@/lib/navigation";

import { RankedPutawayLocations } from "./InboundOptions";
import { FinishedGoodsPutawayConcepts } from "./FinishedGoodsPutawayConcepts";
import { FinishedGoodsPutawayFlow } from "./FinishedGoodsPutawayFlow";
import { InboundSection } from "./InboundPrimitives";
import { ConfirmPutawayForm, PutawayTasksPanel } from "./PutawayTasks";
import { PutawayRecommendationPanel } from "./PutawayRecommendation";

export function PutawayWorkbench() {
  const t = useTranslations("Putaway");
  const warehouseId = useWorkspace().selectedWarehouseId;
  const [selected, setSelected] = useState<PutawayTaskRow | undefined>(
    undefined,
  );

  return (
    <div data-testid="putaway-workbench" className="space-y-6">
      <WorkflowStageRail
        eyebrow={t("workspace.eyebrow")}
        title={t("workspace.title")}
        detail={t("workspace.detail")}
        currentStage={5}
        stages={[
          { label: t("workspace.stage.intake"), href: ROUTES.customerOrders },
          { label: t("workspace.stage.design"), href: ROUTES.engineeringQueue },
          { label: t("workspace.stage.plan"), href: ROUTES.factoryPackets },
          {
            label: t("workspace.stage.produce"),
            href: ROUTES.productionOrders,
          },
          { label: t("workspace.stage.quality"), href: ROUTES.quality },
          { label: t("workspace.stage.store"), href: ROUTES.putaway },
        ]}
        signal={{
          tone: selected === undefined ? "clear" : "attention",
          label:
            selected === undefined
              ? t("workspace.queueReady")
              : selected.status === "READY"
                ? t("workspace.claimPending")
                : t("workspace.locationPending"),
        }}
        nextAction={{
          label: t("workspace.nextBestAction"),
          title:
            selected === undefined
              ? t("workspace.selectAction")
              : selected.status === "READY"
                ? t("workspace.claimAction")
                : t("workspace.confirmAction"),
          detail: t("workspace.actionDetail"),
          action: (
            <a
              href="#putaway-task-board"
              className="inline-flex min-h-touch items-center rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-contrast hover:bg-accent-hover"
            >
              {t("workspace.openTasks")}
            </a>
          ),
        }}
      />

      <details className="rounded-xl border border-border bg-surface px-4 py-3">
        <summary className="min-h-touch cursor-pointer py-2 text-sm font-bold text-text">
          {t("workspace.rulesAndExamples")}
        </summary>
        <div className="space-y-6 pt-3">
          <FinishedGoodsPutawayFlow />
          <FinishedGoodsPutawayConcepts />
        </div>
      </details>

      <div
        id="putaway-task-board"
        className="grid scroll-mt-6 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]"
      >
        <InboundSection title={t("sectionBoard")}>
          <PutawayTasksPanel onSelect={setSelected} />
        </InboundSection>

        <aside className="rounded-xl border border-border bg-surface p-4">
          {selected === undefined ? (
            <InboundSection title={t("sectionRecommendation")}>
              <Notice
                tone="muted"
                title={t("noTaskSelected")}
                body={t("noTaskSelectedHint")}
                testId="putaway-none-selected"
              />
            </InboundSection>
          ) : (
            <>
              <InboundSection title={t("sectionRecommendation")}>
                {warehouseId === undefined ? (
                  <LedgerPanelStatus state={{ kind: "WAREHOUSE_MISSING" }} />
                ) : (
                  <PutawayRecommendationPanel
                    warehouseId={warehouseId}
                    putawayTaskId={selected.putawayTaskId}
                  />
                )}
              </InboundSection>

              <InboundSection title={t("sectionConfirm")}>
                <div className="flex flex-col gap-4">
                  {/*
                   * Stated before the control, not after the refusal: taking
                   * anything but the top recommendation is permitted and needs a
                   * reason, and that is a rule an operator should meet on the way in
                   * (`INV-0007-09`).
                   */}
                  <Notice
                    tone="accent"
                    title={t("overrideNotice")}
                    body={t("confirmDescription")}
                    testId="putaway-override-rule"
                  />
                  {/*
                   * The options come from the **same recommendation the operator was
                   * shown** — after a claim, the trace the server stored. That is
                   * what makes the picker hard-constraint safe without the client
                   * knowing what a hard constraint is: a bin the filters rejected
                   * never entered the ranked list, and the server validates the
                   * choice against the same trace (`INV-0007-08`).
                   */}
                  <RankedPutawayLocations
                    putawayTaskId={selected.putawayTaskId}
                    emptyTitle={t("noRankedLocations")}
                    emptyBody={t("noRankedLocationsHint")}
                    emptyTestId="putaway-no-ranked-locations"
                  >
                    {(values) => (
                      <ConfirmPutawayForm
                        putawayTaskId={selected.putawayTaskId}
                        locations={values.map((entry) => ({
                          value: entry.locationId,
                          label: entry.code,
                        }))}
                      />
                    )}
                  </RankedPutawayLocations>
                </div>
              </InboundSection>
            </>
          )}
        </aside>
      </div>

      <details className="rounded-xl border border-border bg-surface px-4 py-3">
        <summary className="min-h-touch cursor-pointer py-2 font-bold text-text">
          {t("workspace.storageMap")}
        </summary>
        <div className="pt-3">
          <StorageStackPlacementWorkbench />
        </div>
      </details>
    </div>
  );
}
