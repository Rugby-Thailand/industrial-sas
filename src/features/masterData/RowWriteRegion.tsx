"use client";

/**
 * A region of a screen whose rows can each trigger one write.
 *
 * Deactivating a barcode is not a form — there is nothing to type, only a row to
 * point at — but it needs everything a form needs: a gate, an idempotency key, a
 * state machine, and one place that says what happened. This component supplies
 * all four to a render prop, so a table can put a button on every row while the
 * outcome is reported **once**, above the table.
 *
 * One outcome region rather than one per row is a deliberate call. Fifteen rows
 * each capable of showing their own `aria-live` message is fifteen things that
 * can announce at once; a single region announces one sentence, and the row that
 * caused it is the row the operator just pressed.
 *
 * The idempotency key is per **row**, and it survives a transport failure. Both
 * halves matter here in a way they do not for a single-target form: pressing the
 * same row twice must replay one write, and pressing a *different* row must not
 * reuse the first row's key — the server would see the same key with different
 * arguments and answer `REQUEST_ARGUMENT_CONFLICT`, which is a confusing way to
 * be told "that already worked".
 */
import { useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useState, type ReactNode } from "react";

import { WriteOutcomeNotice } from "@/components/masterData/WriteOutcomeNotice";
import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import type { TenantOutcome } from "@/lib/convex/ledgerApi";
import type { MasterDataWriteOutcome } from "@/lib/convex/masterDataApi";
import {
  IDLE,
  isBusy,
  isTerminal,
  newRequestId,
  resolveWriteGate,
  toWriteState,
  type WriteState,
} from "@/lib/convex/writeState";

import type { WriteRef } from "./EntityWriteForm";

import { Button } from "@/components/ui/button";

/** What the region hands its children. */
export interface RowWriteControls<Args> {
  /**
   * Send one write for one row.
   *
   * `rowKey` identifies the target so a retry of the *same* row replays and a
   * press on a different row starts a new request.
   */
  readonly submit: (rowKey: string, build: (requestId: string) => Args) => void;
  readonly state: WriteState;
  readonly busy: boolean;
}

export interface RowWriteRegionProps<Args extends Record<string, unknown>> {
  readonly mutationRef: WriteRef<Args>;
  readonly children: (controls: RowWriteControls<Args>) => ReactNode;
  readonly onSaved?: () => void;
}

export function RowWriteRegion<Args extends Record<string, unknown>>(
  props: RowWriteRegionProps<Args>,
): ReactNode {
  const environment = useAppEnvironment();
  const gate = resolveWriteGate(environment);

  if (gate.kind === "BACKEND_MISSING" || gate.kind === "SIGN_IN_REQUIRED") {
    return <LedgerPanelStatus state={{ kind: gate.kind }} />;
  }
  if (gate.kind === "PREVIEW") return <PreviewRegion {...props} />;
  return <ServerRegion {...props} />;
}

function PreviewRegion<Args extends Record<string, unknown>>({
  children,
}: RowWriteRegionProps<Args>) {
  const [state, setState] = useState<WriteState>(IDLE);

  return (
    <div className="flex flex-col gap-4">
      <WriteOutcomeNotice state={state} />
      {children({
        submit: () => setState({ kind: "DEMONSTRATED" }),
        state,
        busy: false,
      })}
    </div>
  );
}

function ServerRegion<Args extends Record<string, unknown>>({
  mutationRef,
  children,
  onSaved,
}: RowWriteRegionProps<Args>) {
  const mutate = useMutation(
    mutationRef as unknown as FunctionReference<
      "mutation",
      "public",
      Record<string, unknown>,
      TenantOutcome<MasterDataWriteOutcome>
    >,
  );

  const [state, setState] = useState<WriteState>(IDLE);
  /*
   * State rather than a ref, because the render prop is invoked during render
   * and a ref may not be read there. State is the right store anyway: the key
   * only changes when a request reaches a final answer, which is a render.
   */
  const [pending, setPending] = useState<
    { readonly rowKey: string; readonly requestId: string } | undefined
  >(undefined);

  const submit = (rowKey: string, build: (requestId: string) => Args) => {
    // The same row, retried after a failure, reuses its key so the server
    // replays. Any other row gets a fresh one.
    const requestId =
      pending?.rowKey === rowKey ? pending.requestId : newRequestId();
    setPending({ rowKey, requestId });
    setState({ kind: "SUBMITTING" });

    void mutate(build(requestId) as Record<string, unknown>).then(
      (outcome) => {
        const next = toWriteState({
          outcome: outcome as TenantOutcome<MasterDataWriteOutcome>,
        });
        // Final answer: release the key, so the next press is a new request.
        if (isTerminal(next)) setPending(undefined);
        setState(next);
        if (next.kind === "SAVED") onSaved?.();
      },
      // The key is deliberately kept: the retry must replay, not write twice.
      (failure: unknown) => setState(toWriteState({ failure })),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <WriteOutcomeNotice state={state} />
      {children({ submit, state, busy: isBusy(state) })}
    </div>
  );
}

/** The row control itself, so every table spells one the same way. */
export function RowActionButton({
  label,
  busy,
  onClick,
  testId,
}: {
  readonly label: string;
  readonly busy: boolean;
  readonly onClick: () => void;
  readonly testId?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      onClick={onClick}
      className="px-3 text-xs"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      {label}
    </Button>
  );
}
