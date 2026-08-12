"use client";

/**
 * The inspection queue, and the decision that empties it.
 *
 * One screen rather than a queue plus a detail route, because an inspector holds
 * the goods while they decide: navigating away from the list to record a
 * disposition and back again is a round trip on a device they are holding in one
 * hand.
 *
 * The parked state is explained on the screen. `RELEASE` and `SCRAP` need a
 * second person (`INV-0007-06`), so an inspector who submits one sees
 * `PENDING_APPROVAL` rather than a movement — and without the explanation that
 * reads as a failure rather than as the rule working.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Notice } from "@/components/ui/Notice";
import type { InspectionRow } from "@/lib/convex/inboundApi";

import { InboundSection } from "./InboundPrimitives";
import { DispositionForm, InspectionsPanel } from "./QualityInspections";
import { ApproveDispositionControl } from "./QualityApproval";

export function QualityWorkbench() {
  const t = useTranslations("Quality");
  const [selected, setSelected] = useState<InspectionRow | undefined>(
    undefined,
  );

  return (
    <div data-testid="quality-workbench">
      <InboundSection title={t("sectionQueue")}>
        <InspectionsPanel onSelect={setSelected} />
      </InboundSection>

      <InboundSection title={t("sectionDisposition")}>
        {selected === undefined ? (
          <Notice
            tone="muted"
            title={t("noTaskSelected")}
            body={t("noTaskSelectedHint")}
            testId="quality-none-selected"
          />
        ) : (
          <div className="flex flex-col gap-4">
            <Notice
              tone="accent"
              title={t("pendingTitle")}
              body={t("pendingHint")}
              testId="quality-parked-explanation"
            />
            <DispositionForm inspectionId={selected.inspectionId} />
          </div>
        )}
      </InboundSection>

      <InboundSection title={t("approve")}>
        <ApproveDispositionControl />
      </InboundSection>
    </div>
  );
}
