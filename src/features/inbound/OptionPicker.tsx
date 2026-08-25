"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Notice } from "@/components/ui/Notice";
import type { LedgerGate } from "@/lib/convex/ledgerState";

export type OptionSet<Value> =
  | { readonly kind: "LOADING" }
  | { readonly kind: "READY"; readonly values: readonly Value[] }
  | {
      readonly kind: "BLOCKED";
      readonly gate: Exclude<LedgerGate, { kind: "READY_TO_QUERY" }>;
    };

export interface PickerProps<Value> {
  readonly options: OptionSet<Value>;

  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly emptyTestId: string;

  readonly children: (values: readonly Value[]) => ReactNode;
}

export function OptionGate<Value>({
  options,
  emptyTitle,
  emptyBody,
  emptyTestId,
  children,
}: PickerProps<Value>): ReactNode {
  const t = useTranslations("Panel");

  if (options.kind === "BLOCKED") {
    return <LedgerPanelStatus state={options.gate} />;
  }
  if (options.kind === "LOADING") {
    return <Notice tone="muted" title={t("loading")} body={t("loadingHint")} />;
  }
  if (options.values.length === 0) {
    return (
      <Notice
        tone="warning"
        title={emptyTitle}
        body={emptyBody}
        testId={emptyTestId}
      />
    );
  }
  return <>{children(options.values)}</>;
}
