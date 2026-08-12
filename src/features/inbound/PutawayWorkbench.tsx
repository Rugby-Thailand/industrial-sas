"use client";

/**
 * The putaway board, the recommendation, and the confirmation.
 *
 * Three things on one screen because they are one decision: an operator claims a
 * task, reads why a bin was proposed, and either takes it or does not. Splitting
 * them across routes would put a page load between "why this bin?" and the
 * answer.
 *
 * The confirmation offers a **select over the ranked locations**, not a free-text
 * box. A bin that a hard constraint rejected is refused by the server
 * (`INV-0007-08`) — correctly, but only after the pallet has already been
 * moved. Offering only what passed the filters keeps the refusal for the cases
 * that genuinely need it.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Notice } from "@/components/ui/Notice";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import type { PutawayTaskRow } from "@/lib/convex/inboundApi";

import { RankedPutawayLocations } from "./InboundOptions";
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
    <div data-testid="putaway-workbench">
      <InboundSection title={t("sectionBoard")}>
        <PutawayTasksPanel onSelect={setSelected} />
      </InboundSection>

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
    </div>
  );
}
