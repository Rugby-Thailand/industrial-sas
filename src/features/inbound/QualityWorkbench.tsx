"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Notice } from "@/components/ui/Notice";
import { WorkflowStageRail } from "@/components/workflow/WorkflowStageRail";
import type { InspectionRow } from "@/lib/convex/inboundApi";
import { ROUTES } from "@/lib/navigation";

import { InboundSection } from "./InboundPrimitives";
import { DispositionForm, InspectionsPanel } from "./QualityInspections";
import { ApproveDispositionControl } from "./QualityApproval";

export function QualityWorkbench() {
  const t = useTranslations("Quality");
  const [selected, setSelected] = useState<InspectionRow | undefined>(
    undefined,
  );

  return (
    <div data-testid="quality-workbench" className="space-y-6">
      <WorkflowStageRail
        eyebrow={t("workspace.eyebrow")}
        title={t("workspace.title")}
        detail={t("workspace.detail")}
        currentStage={4}
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
              : t("workspace.decisionPending"),
        }}
        nextAction={{
          label: t("workspace.nextBestAction"),
          title:
            selected === undefined
              ? t("workspace.selectAction")
              : t("workspace.decideAction"),
          detail: t("workspace.actionDetail"),
          action: (
            <a
              href="#quality-decision"
              className="inline-flex min-h-touch items-center rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-contrast hover:bg-accent-hover"
            >
              {t("workspace.openQueue")}
            </a>
          ),
        }}
      />

      <div
        id="quality-decision"
        className="grid scroll-mt-6 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]"
      >
        <InboundSection title={t("sectionQueue")}>
          <InspectionsPanel onSelect={setSelected} />
        </InboundSection>

        <aside className="rounded-xl border border-border bg-surface p-4">
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
        </aside>
      </div>

      {/*
       * The section is named for what it is — a second person's step — rather
       * than for the button inside it, which says "approve this disposition"
       * once, where it acts.
       */}
      <details className="rounded-xl border border-border bg-surface px-4 py-3">
        <summary className="min-h-touch cursor-pointer py-2 font-bold text-text">
          {t("sectionApproval")}
        </summary>
        <div className="pt-3">
          <ApproveDispositionControl />
        </div>
      </details>
    </div>
  );
}
