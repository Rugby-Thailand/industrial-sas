"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveScanToItemRef } from "@/lib/convex/masterDataApi";

import { CatalogueGate } from "./CatalogueOptions";

export interface ScannedItem {
  readonly itemId: string;
  readonly sku: string;

  readonly scanValue: string;
}

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
      ? {
          itemId: outcome.value.itemId,
          sku: outcome.value.sku,
          scanValue: scan.trim().normalize("NFC").toUpperCase(),
        }
      : undefined;

  return (
    <ScanShell
      label={label}
      hint={hint}
      onScan={setScan}

      miss={scan !== "" && outcome !== undefined && resolved === undefined}
    >
      {children(resolved)}
    </ScanShell>
  );
}

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
            // Enter resolves the scan; it must never submit the surrounding form.
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
