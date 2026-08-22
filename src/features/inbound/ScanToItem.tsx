"use client";

/**
 * The scan box that turns what came off the carton into an item.
 *
 * Its own module rather than a section of `CatalogueOptions` because it is the
 * one control in that file that reads the receiving catalogue, and it is used by
 * exactly one form (`ReceiptLineForm`). While it lived there, every screen that
 * needed a supplier, an item, or a reason code — including quality and putaway,
 * which never scan anything — reached the `Receiving` namespace through it, and
 * that namespace is 10.5 kB of Thai.
 *
 * The gate and the option conventions are still `CatalogueOptions`'; only the
 * scan control moved.
 */
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveScanToItemRef } from "@/lib/convex/masterDataApi";

import { CatalogueGate } from "./CatalogueOptions";

/** What a scan box has last decided. `undefined` means nothing scanned yet. */
export interface ScannedItem {
  readonly itemId: string;
  readonly sku: string;
}

/**
 * A scan box that turns what came off the carton into an item.
 *
 * The counterpart to the pickers above, for the moment when the operator is not
 * choosing from a list at all: they are holding a box, and the wedge scanner has
 * just typed a barcode into whatever had focus. Resolution is a server read
 * (`resolveScanToItem`) over the tenant's own barcodes and SKUs, because the
 * catalogue is the only thing that can say what a string refers to.
 *
 * A render prop rather than a callback, like every other source in this file:
 * the caller renders *with* the scanned item, so there is no effect firing into
 * somebody else's state and no moment where the form and the scan disagree.
 *
 * It is a separate control rather than a field inside the capture form for a
 * plain reason: a scanner ends its input with Enter, and a field that submitted
 * the whole receipt line on Enter would post half-filled lines all shift.
 */
export function ScanToItem({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly children: (scanned: ScannedItem | undefined) => ReactNode;
}) {
  return (
    <CatalogueGate
      render={() => (
        <ServerScanToItem label={label} hint={hint}>
          {children}
        </ServerScanToItem>
      )}
    />
  );
}

interface ScanBranchProps {
  readonly label: string;
  readonly hint: string;
  readonly children: (scanned: ScannedItem | undefined) => ReactNode;
}

function ServerScanToItem({ label, hint, children }: ScanBranchProps) {
  const [scan, setScan] = useState("");
  const outcome = useQuery(
    resolveScanToItemRef,
    scan === "" ? "skip" : { scan },
  );

  const resolved =
    outcome !== undefined && outcome.ok && outcome.value.found
      ? { itemId: outcome.value.itemId, sku: outcome.value.sku }
      : undefined;

  return (
    <ScanShell
      label={label}
      hint={hint}
      onScan={setScan}
      /*
       * A miss only once the read has answered. Showing "unknown barcode" while
       * the query is still in flight would teach operators to rescan a label
       * that was about to resolve.
       */
      miss={scan !== "" && outcome !== undefined && resolved === undefined}
    >
      {children(resolved)}
    </ScanShell>
  );
}

/** The input, its explanation, its miss, and whatever the scan unlocked. */
function ScanShell({
  label,
  hint,
  onScan,
  miss,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly onScan: (scan: string) => void;
  readonly miss: boolean;
  readonly children: ReactNode;
}) {
  const t = useTranslations("Receiving");
  const [text, setText] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2" data-testid="scan-to-item">
        <label
          htmlFor="scan-to-item-input"
          className="text-sm font-medium text-text"
        >
          {label}
        </label>
        <p className="text-sm text-muted" id="scan-to-item-hint">
          {hint}
        </p>
        <div className="flex gap-2">
          <Input
            id="scan-to-item-input"
            aria-describedby="scan-to-item-hint"
            value={text}
            onChange={(event) => setText(event.target.value)}
            /*
             * Enter resolves rather than submits. This control sits outside the
             * capture form precisely so a wedge's terminator cannot post a line.
             */
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onScan(text.trim());
              }
            }}
            className="font-mono text-sm"
          />
          <Button
            type="button"
            variant="outline"
            data-testid="scan-to-item-resolve"
            onClick={() => onScan(text.trim())}
          >
            {t("scanResolve")}
          </Button>
        </div>
        {miss ? (
          <Notice
            tone="warning"
            title={t("scanUnknown")}
            body={t("scanUnknownHint")}
            testId="scan-to-item-unknown"
          />
        ) : null}
      </div>
      {children}
    </div>
  );
}
