"use client";

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

      {/*
       * The section is named for what it is — a second person's step — rather
       * than for the button inside it, which says "approve this disposition"
       * once, where it acts.
       */}
      <InboundSection title={t("sectionApproval")}>
        <ApproveDispositionControl />
      </InboundSection>
    </div>
  );
}
