"use client";

/**
 * A picker over an `OptionSet`, and the three things it can honestly say.
 *
 * Every inbound screen needs the operator to choose something a server read
 * supplied — a dock, an open order, a task's ranked bins — and every one of them
 * has the same three outcomes. Writing them once means a blocked read and an
 * empty warehouse are told apart everywhere rather than in the screens somebody
 * remembered.
 *
 * The empty case is the one worth stating. "This site has no receiving location
 * configured" is a master-data job for a supervisor, and it is *not* an error:
 * the read succeeded and the answer is none. Rendering an empty select instead
 * would let an operator submit a form whose refusal names a field they were
 * never able to fill.
 */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Notice } from "@/components/ui/Notice";
import type { LedgerGate } from "@/lib/convex/ledgerState";

/**
 * What a picker may offer, and why it can offer nothing.
 *
 * Three states because a picker has three, and a screen that collapses any two
 * of them lies: a read in flight has not said "none", and an empty warehouse is
 * a different job from an unchosen one.
 */
export type OptionSet<Value> =
  | { readonly kind: "LOADING" }
  | { readonly kind: "READY"; readonly values: readonly Value[] }
  | {
      readonly kind: "BLOCKED";
      readonly gate: Exclude<LedgerGate, { kind: "READY_TO_QUERY" }>;
    };

export interface PickerProps<Value> {
  readonly options: OptionSet<Value>;
  /** What an empty-but-successful read means on this screen. */
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly emptyTestId: string;
  /** Rendered only when there is at least one option. */
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
    // Not "none": a read in flight has not said there is nothing.
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
