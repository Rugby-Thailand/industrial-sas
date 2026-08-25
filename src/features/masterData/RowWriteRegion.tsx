"use client";

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

export interface RowWriteControls<Args> {
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
  return <ServerRegion {...props} />;
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

        if (isTerminal(next)) setPending(undefined);
        setState(next);
        if (next.kind === "SAVED") onSaved?.();
      },
      // Keep the request key so a retry replays instead of writing twice.
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

export function RowActionButton({
  label,
  busy,
  onClick,
  testId,
  title,
}: {
  readonly label: string;
  readonly busy: boolean;
  readonly onClick: () => void;
  readonly testId?: string;

  readonly title?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      onClick={onClick}
      className="px-3 text-xs"
      {...(testId === undefined ? {} : { "data-testid": testId })}
      {...(title === undefined ? {} : { title })}
    >
      {label}
    </Button>
  );
}
