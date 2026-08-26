"use client";

import { useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";

import {
  EntityForm,
  type FormFieldSpec,
  type FormSectionSpec,
  type FormValues,
  type MobileStepperLabels,
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

import { WriteDialog, useWriteSurface } from "./WriteDialog";

export type WriteRef<Args extends Record<string, unknown>> = FunctionReference<
  "mutation",
  "public",
  Args,
  TenantOutcome<MasterDataWriteOutcome>
>;

export interface EntityWriteFormProps<Args extends Record<string, unknown>> {
  readonly mutationRef: WriteRef<Args>;
  readonly legend: string;
  readonly triggerIcon?: ReactNode;
  readonly description?: string;
  readonly submitLabel: string;
  readonly requiredMessage: string;
  readonly fields: readonly FormFieldSpec[];

  readonly toArgs: (values: FormValues, requestId: string) => Args;

  readonly onSaved?: (outcome: Record<string, unknown>) => void;
  readonly testId?: string;
  readonly presentation?: "auto" | "inline";
  readonly dialogSize?: "compact" | "wide" | "workspace";
  readonly dialogIntent?: "create" | "action";
  readonly sections?: readonly FormSectionSpec[];
  readonly mobileStepperLabels?: MobileStepperLabels;
}

export function EntityWriteForm<Args extends Record<string, unknown>>(
  props: EntityWriteFormProps<Args>,
): ReactNode {
  const environment = useAppEnvironment();
  const gate = resolveWriteGate(environment);
  const writeSurface = useWriteSurface();
  const writeT = useTranslations("Write");

  if (gate.kind === "BACKEND_MISSING" || gate.kind === "SIGN_IN_REQUIRED") {
    return <LedgerPanelStatus state={{ kind: gate.kind }} />;
  }
  if (props.presentation !== "inline" && writeSurface === null) {
    return (
      <WriteDialog
        triggerLabel={props.legend}
        {...(props.triggerIcon === undefined
          ? {}
          : { triggerIcon: props.triggerIcon })}
        title={props.legend}
        {...(props.description === undefined
          ? {}
          : { description: props.description })}
        closeLabel={writeT("closeForm")}
        size={props.dialogSize ?? "compact"}
        showPlus={props.dialogIntent === "create"}
        triggerVariant={props.dialogIntent === "create" ? "default" : "outline"}
        {...(props.testId === undefined ? {} : { testId: props.testId })}
      >
        <ServerWriteForm {...props} />
      </WriteDialog>
    );
  }
  return <ServerWriteForm {...props} />;
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
  sections,
  mobileStepperLabels,
}: EntityWriteFormProps<Args>) {
  const writeSurface = useWriteSurface();
  // Keep the cast at this boundary; Convex cannot resolve the open generic.
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

        if (isTerminal(next)) requestIdRef.current = undefined;
        setState(next);
        if (next.kind === "SAVED") {
          setResetSignal((current) => current + 1);
          onSaved?.(outcome as unknown as Record<string, unknown>);
          if (writeSurface?.closeOnSaved === true) writeSurface.complete();
        }
      },
      (failure: unknown) => {
        // Keep the request key so a retry replays instead of writing twice.
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
      legendPresentation={writeSurface?.embedded ? "sr-only" : "visible"}
      {...(sections === undefined ? {} : { sections })}
      {...(mobileStepperLabels === undefined ? {} : { mobileStepperLabels })}
      onSubmit={submit}
      {...(testId === undefined ? {} : { testId })}
    />
  );
}
