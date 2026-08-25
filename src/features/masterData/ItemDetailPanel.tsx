"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  deactivateItemRef,
  getItemRef,
  type ItemDetail,
  type ItemRow,
} from "@/lib/convex/masterDataApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";

import { ItemEditForm } from "./CoreForms";
import { RowActionButton, RowWriteRegion } from "./RowWriteRegion";
import {
  BarcodeForm,
  ItemBarcodesPanel,
  ItemLotsPanel,
  ItemUomForm,
  ItemUomsPanel,
  LotForm,
  PanelSection,
} from "./EntityPanels";

export function ItemDetailPanel({ itemId }: { readonly itemId: string }) {
  return (
    <QueryGate scope="ORG">
      {() => <ServerItemDetail itemId={itemId} />}
    </QueryGate>
  );
}

function ServerItemDetail({ itemId }: { readonly itemId: string }) {
  const outcome = useQuery(getItemRef, { itemId });

  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  }

  const detail: ItemDetail = outcome.value;
  return detail.found ? <ItemDetailBody item={detail.item} /> : <ItemMissing />;
}

function ItemMissing() {
  const t = useTranslations("MasterData");
  return (
    <Notice
      tone="warning"
      title={t("itemNotFound")}
      body={t("itemNotFoundHint")}
      testId="item-not-found"
    />
  );
}

function ItemDetailBody({ item }: { readonly item: ItemRow }) {
  const t = useTranslations("MasterData");
  const statusT = useTranslations(
    "MasterDataStatus",
  ) as unknown as CodeTranslator;
  const trackingT = useTranslations(
    "TrackingMode",
  ) as unknown as CodeTranslator;

  return (
    <div data-testid="item-detail">
      <div className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4">
        {/* The SKU stays monospaced and English: it is a code identifier (`D-06`). */}
        <code className="font-mono text-sm font-semibold text-text">
          {item.sku}
        </code>
        <span className="text-sm">{item.name}</span>
        <span className="font-mono text-xs text-muted">{item.baseUom}</span>
        <StatusBadge
          tone={item.trackingMode === "LOT_SERIAL" ? "warning" : "neutral"}
          label={codeLabel(trackingT, item.trackingMode)}
        />
        <StatusBadge
          tone={item.status === "ACTIVE" ? "success" : "muted"}
          label={codeLabel(statusT, item.status)}
        />
      </div>

      {/*
       * Deactivation is one-way from this screen, because `updateItem` does not
       * accept a status: an item is withdrawn from use, and bringing it back is
       * a decision someone should make deliberately rather than by pressing the
       * same button twice.
       */}
      {item.status === "ACTIVE" ? (
        <div className="mb-8">
          <RowWriteRegion mutationRef={deactivateItemRef}>
            {({ submit, busy }) => (
              <RowActionButton
                busy={busy}
                testId="item-deactivate"
                label={t("deactivate")}
                onClick={() =>
                  submit(item.itemId, (requestId) => ({
                    requestId,
                    itemId: item.itemId,
                  }))
                }
              />
            )}
          </RowWriteRegion>
        </div>
      ) : null}

      <PanelSection title={t("sectionBarcodes")}>
        <ItemBarcodesPanel itemId={item.itemId} />
        <BarcodeForm itemId={item.itemId} />
      </PanelSection>

      <PanelSection title={t("sectionUoms")}>
        <ItemUomsPanel itemId={item.itemId} baseUom={item.baseUom} />
        <ItemUomForm itemId={item.itemId} baseUom={item.baseUom} />
      </PanelSection>

      <PanelSection title={t("sectionLots")}>
        <ItemLotsPanel itemId={item.itemId} />
        {/*
         * The lot form is offered whatever the tracking mode. An item tracked as
         * `NONE` has no lots and the server refuses one, which is the answer
         * that teaches the rule; hiding the form would leave an operator
         * wondering whether the feature exists.
         */}
        <LotForm itemId={item.itemId} />
      </PanelSection>

      <PanelSection title={t("sectionEdit")}>
        <ItemEditForm item={item} />
      </PanelSection>
    </div>
  );
}
