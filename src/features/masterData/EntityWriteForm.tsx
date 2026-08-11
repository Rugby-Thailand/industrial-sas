"use client";

/**
 * A master-data write, gated and sent.
 *
 * The write-side counterpart of `MasterDataPanel`, and it splits into the same
 * three branches for the same reason: `useMutation` throws without a
 * `ConvexProvider`, and there is no provider when no deployment is configured
 * (`ConvexClientProvider`). So the gate is decided *before* the hook is reached,
 * and the branch that calls it is a separate component.
 *
 * The idempotency key is the part worth reading closely. One key is minted per
 * *attempt*, held in a ref, and released only when the server gives a final
 * answer. A transport failure is not a final answer — the mutation may have run
 * — so the retry reuses the key, and the server replays instead of writing a
 * second row (`convex/lib/idempotency.ts`). A key released on failure would turn
 * one flaky network moment into two suppliers with the same name.
 *
 * In preview mode nothing is sent. The form validates, the outcome says plainly
 * that nothing was stored, and the typed values stay on screen: clearing them
 * would imply a save that did not happen.
 */
import { useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useRef, useState, type ReactNode } from "react";

import {
  EntityForm,
  type FormFieldSpec,
  type FormValues,
} from "@/components/masterData/EntityForm";
import { WriteOutcomeNotice } from "@/components/masterData/WriteOutcomeNotice";
import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import type { TenantOutcome } from "@/lib/convex/ledgerApi";
import type { MasterDataWriteOutcome } from "@/lib/convex/masterDataApi";
import {
  IDLE,
  invalidField,
  isBusy,
  isTerminal,
  newRequestId,
  resolveWriteGate,
  toWriteState,
  type WriteState,
} from "@/lib/convex/writeState";

/** A mutation that answers the master-data write envelope. */
export type WriteRef<Args extends Record<string, unknown>> = FunctionReference<
  "mutation",
  "public",
  Args,
  TenantOutcome<MasterDataWriteOutcome>
>;

export interface EntityWriteFormProps<Args extends Record<string, unknown>> {
  readonly mutationRef: WriteRef<Args>;
  readonly legend: string;
  readonly description?: string;
  readonly submitLabel: string;
  readonly requiredMessage: string;
  readonly fields: readonly FormFieldSpec[];
  /**
   * Build the mutation's arguments. Given the request ID so the key travels
   * with the arguments it is a fingerprint of, rather than being bolted on
   * afterwards where an argument change could slip past it.
   */
  readonly toArgs: (values: FormValues, requestId: string) => Args;
  /**
   * Called after the server confirms a write.
   *
   * Receives the write envelope, because some mutations answer with more than
   * "it was written" — a receipt posting reports its classification and where
   * the stock landed, an import chunk reports the cursor to resume from — and
   * those facts are the whole reason the calling screen exists.
   */
  readonly onSaved?: (outcome: Record<string, unknown>) => void;
  /**
   * Called after a preview-mode submission, which stored nothing.
   *
   * Separate from `onSaved` on purpose: a caller that treated the two as the
   * same would advance real state on a demonstration. A caller that wants to
   * walk a multi-step flow in preview opts in here and says on screen that
   * nothing was stored.
   */
  readonly onDemonstrated?: () => void;
  readonly testId?: string;
}

export function EntityWriteForm<Args extends Record<string, unknown>>(
  props: EntityWriteFormProps<Args>,
): ReactNode {
  const environment = useAppEnvironment();
  const gate = resolveWriteGate(environment);

  if (gate.kind === "BACKEND_MISSING" || gate.kind === "SIGN_IN_REQUIRED") {
    return <LedgerPanelStatus state={{ kind: gate.kind }} />;
  }
  if (gate.kind === "PREVIEW") return <PreviewWriteForm {...props} />;
  return <ServerWriteForm {...props} />;
}

function PreviewWriteForm<Args extends Record<string, unknown>>({
  legend,
  description,
  submitLabel,
  requiredMessage,
  fields,
  testId,
  onDemonstrated,
}: EntityWriteFormProps<Args>) {
  const [state, setState] = useState<WriteState>(IDLE);

  return (
    <EntityForm
      legend={legend}
      {...(description === undefined ? {} : { description })}
      fields={fields}
      submitLabel={submitLabel}
      requiredMessage={requiredMessage}
      busy={false}
      outcome={<WriteOutcomeNotice state={state} />}
      onSubmit={() => {
        setState({ kind: "DEMONSTRATED" });
        onDemonstrated?.();
      }}
      {...(testId === undefined ? {} : { testId })}
    />
  );
}

function ServerWriteForm<Args extends Record<string, unknown>>({
  mutationRef,
  legend,
  description,
  submitLabel,
  requiredMessage,
  fields,
  toArgs,
  onSaved,
  testId,
}: EntityWriteFormProps<Args>) {
  /*
   * The generic is erased here and only here, for the reason `MasterDataPanel`
   * documents: `useMutation`'s argument type cannot be resolved while `Args` is
   * still open. The caller's types survive, because `toArgs` is checked against
   * the reference's own argument type at the point where a wrong argument would
   * actually be written.
   */
  const mutate = useMutation(
    mutationRef as unknown as FunctionReference<
      "mutation",
      "public",
      Record<string, unknown>,
      TenantOutcome<MasterDataWriteOutcome>
    >,
  );

  const [state, setState] = useState<WriteState>(IDLE);
  const [resetSignal, setResetSignal] = useState(0);
  const requestIdRef = useRef<string | undefined>(undefined);

  const submit = (values: FormValues) => {
    const requestId = requestIdRef.current ?? newRequestId();
    requestIdRef.current = requestId;
    setState({ kind: "SUBMITTING" });

    void mutate(toArgs(values, requestId) as Record<string, unknown>).then(
      (outcome) => {
        const next = toWriteState({
          outcome: outcome as TenantOutcome<MasterDataWriteOutcome>,
        });
        // Final answer: the next submission is a new request and needs a new key.
        if (isTerminal(next)) requestIdRef.current = undefined;
        setState(next);
        if (next.kind === "SAVED") {
          setResetSignal((current) => current + 1);
          onSaved?.(outcome as unknown as Record<string, unknown>);
        }
      },
      (failure: unknown) => {
        // The key is deliberately *not* released: the retry must replay.
        setState(toWriteState({ failure }));
      },
    );
  };

  const blamed = invalidField(state);

  return (
    <EntityForm
      legend={legend}
      {...(description === undefined ? {} : { description })}
      fields={fields}
      submitLabel={submitLabel}
      requiredMessage={requiredMessage}
      busy={isBusy(state)}
      {...(blamed === undefined ? {} : { invalidField: blamed })}
      outcome={<WriteOutcomeNotice state={state} />}
      resetSignal={resetSignal}
      onSubmit={submit}
      {...(testId === undefined ? {} : { testId })}
    />
  );
}
