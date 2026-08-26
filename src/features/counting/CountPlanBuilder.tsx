"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import {
  ArrowLeftRight,
  Crosshair,
  Eye,
  EyeOff,
  ListChecks,
  RefreshCw,
  SlidersHorizontal,
  Snowflake,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { WriteOutcomeNotice } from "@/components/masterData/WriteOutcomeNotice";
import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import {
  Field,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { SelectControl } from "@/components/ui/SelectControl";
import { RowWriteRegion } from "@/features/masterData/RowWriteRegion";
import { WriteDialog } from "@/features/masterData/WriteDialog";
import {
  createCountPlanRef,
  releaseCountPlanRef,
} from "@/lib/convex/countingApi";
import {
  DEFAULT_LEDGER_PAGE_SIZE,
  listBalancesRef,
  type BalanceRow,
  type TenantOutcome,
} from "@/lib/convex/ledgerApi";
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
import { describeBucketKey } from "@/lib/inventory/bucketIdentity";

export function CountPlanBuilder() {
  const t = useTranslations("Count");
  const writeT = useTranslations("Write");
  return (
    <div className="flex justify-end">
      <WriteDialog
        triggerLabel={t("planLegend")}
        closeLabel={writeT("closeForm")}
        size="wide"
        testId="count-plan-dialog"
      >
        <QueryGate scope="WAREHOUSE">
          {(warehouseId) => (
            <ServerCountPlanBuilder warehouseId={warehouseId} />
          )}
        </QueryGate>
      </WriteDialog>
    </div>
  );
}

function ServerCountPlanBuilder({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const outcome = useQuery(listBalancesRef, {
    warehouseId,
    maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
  });
  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  if (!outcome.value.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "ERROR", code: outcome.value.error.code }}
      />
    );
  return (
    <CountPlanForm warehouseId={warehouseId} balances={outcome.value.items} />
  );
}

function physicalBalances(rows: readonly BalanceRow[]) {
  return rows.filter((row) =>
    describeBucketKey(row.bucketKey).some(
      (part) => part.dimension === "location",
    ),
  );
}

function CountPlanForm(props: {
  readonly warehouseId: string;
  readonly balances: readonly BalanceRow[];
}) {
  const environment = useAppEnvironment();
  const gate = resolveWriteGate(environment);

  if (gate.kind === "BACKEND_MISSING" || gate.kind === "SIGN_IN_REQUIRED") {
    return <LedgerPanelStatus state={{ kind: gate.kind }} />;
  }
  return <ServerCountPlanForm {...props} />;
}

const RISK_DEFAULTS = Object.freeze({
  quantityThreshold: "1000",
  valueThreshold: "100000",
  itemClass: "C",
  unitValue: "0",
});

const INITIAL_VALUES = Object.freeze({
  planNumber: "COUNT-",
  targetBucket: "",
  scope: "CYCLE",
  visibility: "BLIND",
  movementPolicy: "MOVEMENT_AWARE",
  ...RISK_DEFAULTS,
});

type PlanValues = { readonly [K in keyof typeof INITIAL_VALUES]: string };
type PlanField = keyof PlanValues;

const RISK_FIELDS = Object.freeze([
  "quantityThreshold",
  "valueThreshold",
  "itemClass",
  "unitValue",
] as const);

const REQUIRED_FIELDS = Object.freeze([
  "planNumber",
  "targetBucket",
  ...RISK_FIELDS,
] as const);

const BLAME_TO_FIELD: Readonly<Record<string, PlanField>> = Object.freeze({
  planNumber: "planNumber",
  scope: "scope",
  visibility: "visibility",
  movementPolicy: "movementPolicy",
  bucketKey: "targetBucket",
  itemClass: "itemClass",
  threshold: "quantityThreshold",
  quantityThresholdBaseMinorUnits: "quantityThreshold",
  unitValueMinorUnits: "unitValue",
  valueThresholdMinorUnits: "valueThreshold",
  targets: "targetBucket",
});

function blamedField(state: WriteState): PlanField | undefined {
  if (state.kind === "REFUSED") {
    if (state.code === "THRESHOLD_INVALID") return "quantityThreshold";
    if (state.code === "VALUATION_INVALID") return "itemClass";
  }
  const name = invalidField(state);
  return name === undefined ? undefined : BLAME_TO_FIELD[name];
}

interface PolicyChoice {
  readonly value: string;
  readonly label: string;
  readonly hint: string;
  readonly icon: LucideIcon;
}

function ServerCountPlanForm({
  warehouseId,
  balances,
}: {
  readonly warehouseId: string;
  readonly balances: readonly BalanceRow[];
}) {
  const t = useTranslations("Count");
  const formId = useId();
  const mutate = useMutation(
    createCountPlanRef as unknown as FunctionReference<
      "mutation",
      "public",
      Record<string, unknown>,
      TenantOutcome<MasterDataWriteOutcome>
    >,
  );

  const [values, setValues] = useState<PlanValues>(INITIAL_VALUES);
  const [missing, setMissing] = useState<readonly PlanField[]>([]);
  const [riskOpen, setRiskOpen] = useState(false);
  const [state, setState] = useState<WriteState>(IDLE);
  const [saved, setSaved] = useState<{
    readonly planId: string;
    readonly planNumber: string;
  }>();
  const requestIdRef = useRef<string | undefined>(undefined);
  const freezeExpiresAtRef = useRef<number | undefined>(undefined);

  const targets = physicalBalances(balances);
  const busy = isBusy(state);
  const blamed = blamedField(state);

  useEffect(() => {
    if (blamed === undefined) return;
    document.getElementById(`${formId}-${blamed}`)?.focus();
  }, [blamed, formId]);

  const change = (name: PlanField, next: string) => {
    // Editing after an ambiguous transport failure starts a genuinely new
    // attempt. An unchanged retry keeps both the request ID and frozen expiry,
    // so the server sees the exact same fingerprint and can replay it.
    if (state.kind === "FAILED") {
      requestIdRef.current = undefined;
      freezeExpiresAtRef.current = undefined;
    }
    setValues((current) => ({ ...current, [name]: next }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const blank = REQUIRED_FIELDS.filter((name) => values[name].trim() === "");
    setMissing(blank);
    if (blank.length > 0) return;

    // Same key discipline as `EntityWriteForm`: reused after a transport
    // failure so the retry replays, released only on a terminal answer.
    const requestId = requestIdRef.current ?? newRequestId();
    requestIdRef.current = requestId;
    setState({ kind: "SUBMITTING" });

    const planNumber = values.planNumber.trim();
    const freezeExpiresAt =
      values.movementPolicy === "FROZEN"
        ? (freezeExpiresAtRef.current ?? Date.now() + 60 * 60 * 1000)
        : undefined;
    freezeExpiresAtRef.current = freezeExpiresAt;
    void mutate({
      requestId,
      warehouseId,
      planNumber,
      scope: values.scope as "FULL" | "CYCLE" | "SPOT",
      visibility: values.visibility as "BLIND" | "VISIBLE",
      movementPolicy: values.movementPolicy as "FROZEN" | "MOVEMENT_AWARE",
      ...(freezeExpiresAt === undefined ? {} : { freezeExpiresAt }),
      quantityThresholdBaseMinorUnits: Number(values.quantityThreshold.trim()),
      valueThresholdMinorUnits: Number(values.valueThreshold.trim()),
      targets: [
        {
          bucketKey: values.targetBucket,
          itemClass: values.itemClass.trim(),
          unitValueMinorUnits: Number(values.unitValue.trim()),
        },
      ],
    }).then(
      (outcome) => {
        const next = toWriteState({ outcome });
        if (isTerminal(next)) {
          requestIdRef.current = undefined;
          freezeExpiresAtRef.current = undefined;
        }
        setState(next);
        if (next.kind === "SAVED") {
          setSaved({ planId: next.documentId, planNumber });
          setValues(INITIAL_VALUES);
          setMissing([]);
          setRiskOpen(false);
        }
      },
      // Keep the request key so a retry replays instead of writing twice.
      (failure: unknown) => setState(toWriteState({ failure })),
    );
  };

  const scopeChoices: readonly PolicyChoice[] = [
    {
      value: "FULL",
      label: t("scopeFull"),
      hint: t("scopeFullHint"),
      icon: Warehouse,
    },
    {
      value: "CYCLE",
      label: t("scopeCycle"),
      hint: t("scopeCycleHint"),
      icon: RefreshCw,
    },
    {
      value: "SPOT",
      label: t("scopeSpot"),
      hint: t("scopeSpotHint"),
      icon: Crosshair,
    },
  ];
  const visibilityChoices: readonly PolicyChoice[] = [
    {
      value: "BLIND",
      label: t("visibilityBlind"),
      hint: t("visibilityBlindHint"),
      icon: EyeOff,
    },
    {
      value: "VISIBLE",
      label: t("visibilityVisible"),
      hint: t("visibilityVisibleHint"),
      icon: Eye,
    },
  ];
  const movementChoices: readonly PolicyChoice[] = [
    {
      value: "MOVEMENT_AWARE",
      label: t("movementAware"),
      hint: t("movementAwareHint"),
      icon: ArrowLeftRight,
    },
    {
      value: "FROZEN",
      label: t("movementFrozen"),
      hint: t("movementFrozenHint"),
      icon: Snowflake,
    },
  ];

  const riskBlamed =
    blamed !== undefined && (RISK_FIELDS as readonly string[]).includes(blamed);
  const riskMissing = RISK_FIELDS.some((name) => missing.includes(name));
  const showRisk = riskOpen || riskBlamed || riskMissing;
  const riskAtDefaults = RISK_FIELDS.every(
    (name) => values[name].trim() === RISK_DEFAULTS[name],
  );

  const textField = (spec: {
    readonly name: PlanField;
    readonly label: string;
    readonly required?: boolean;
    readonly monospace?: boolean;
    readonly numeric?: boolean;
  }) => {
    const controlId = `${formId}-${spec.name}`;
    const errorId = `${controlId}-error`;
    const isMissing = missing.includes(spec.name);
    const invalid = isMissing || blamed === spec.name;
    return (
      <Field data-invalid={invalid ? true : undefined}>
        <FieldLabel htmlFor={controlId} className="text-text">
          {spec.label}
        </FieldLabel>
        <Input
          id={controlId}
          name={spec.name}
          type="text"
          value={values[spec.name]}
          aria-invalid={invalid ? true : undefined}
          aria-required={spec.required === true ? true : undefined}
          aria-describedby={isMissing ? errorId : undefined}
          className={spec.monospace === true ? "font-mono" : ""}
          {...(spec.numeric === true ? { inputMode: "numeric" as const } : {})}
          onChange={(event) => change(spec.name, event.target.value)}
        />
        {isMissing ? (
          <FieldError id={errorId} className="text-xs font-medium">
            {t("required")}
          </FieldError>
        ) : null}
      </Field>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <form
        noValidate
        onSubmit={submit}
        data-testid="count-plan-form"
        className="@container/form flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      >
        <FieldSet disabled={busy} className="border-0 p-0">
          <FieldLegend variant="label" className="text-text">
            {t("planLegend")}
          </FieldLegend>

          {/* The saved ending is announced by the release card below, which
              carries the next step; repeating it here would say it twice. */}
          {state.kind === "SAVED" ? null : <WriteOutcomeNotice state={state} />}

          <div className="grid gap-4 @xl/form:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field
              data-invalid={
                missing.includes("targetBucket") || blamed === "targetBucket"
                  ? true
                  : undefined
              }
            >
              <FieldLabel
                htmlFor={`${formId}-targetBucket`}
                className="text-text"
              >
                {t("targetBucket")}
              </FieldLabel>
              <SelectControl
                id={`${formId}-targetBucket`}
                name="targetBucket"
                value={values.targetBucket}
                options={targets.map((row) => ({
                  value: row.bucketKey,
                  label: `${describeBucketKey(row.bucketKey)
                    .map((part) => `${part.dimension}: ${part.value}`)
                    .join(" · ")} · ${row.minorUnits} ${row.uom}`,
                }))}
                onValueChange={(next) => change("targetBucket", next)}
                placeholder={t("selectTarget")}
                emptyLabel={t("selectTarget")}
                invalid={
                  missing.includes("targetBucket") || blamed === "targetBucket"
                }
                describedBy={
                  missing.includes("targetBucket")
                    ? `${formId}-targetBucket-error`
                    : ""
                }
                required
              />
              {missing.includes("targetBucket") ? (
                <FieldError
                  id={`${formId}-targetBucket-error`}
                  className="text-xs font-medium"
                >
                  {t("required")}
                </FieldError>
              ) : null}
            </Field>

            {textField({
              name: "planNumber",
              label: t("planNumber"),
              required: true,
              monospace: true,
            })}
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-text">
              {t("policyLegend")}
            </p>
            <div className="grid gap-4 @xl/form:grid-cols-3">
              <PolicyGroup
                controlId={`${formId}-scope`}
                label={t("scope")}
                choices={scopeChoices}
                value={values.scope}
                onChange={(next) => change("scope", next)}
                invalid={blamed === "scope"}
              />
              <PolicyGroup
                controlId={`${formId}-visibility`}
                label={t("visibility")}
                choices={visibilityChoices}
                value={values.visibility}
                onChange={(next) => change("visibility", next)}
                invalid={blamed === "visibility"}
              />
              <PolicyGroup
                controlId={`${formId}-movementPolicy`}
                label={t("movementPolicy")}
                choices={movementChoices}
                value={values.movementPolicy}
                onChange={(next) => change("movementPolicy", next)}
                invalid={blamed === "movementPolicy"}
              />
            </div>
          </div>

          <CollapsibleSection
            label={t("riskSettings")}
            icon={SlidersHorizontal}
            {...(riskAtDefaults ? { badge: t("riskDefaults") } : {})}
            open={showRisk}
            onToggle={setRiskOpen}
            contentClassName="grid gap-4 @xl/form:grid-cols-2"
          >
            {textField({
              name: "quantityThreshold",
              label: t("quantityThreshold"),
              required: true,
              numeric: true,
            })}
            {textField({
              name: "valueThreshold",
              label: t("valueThreshold"),
              required: true,
              numeric: true,
            })}
            {textField({
              name: "itemClass",
              label: t("itemClass"),
              required: true,
              monospace: true,
            })}
            {textField({
              name: "unitValue",
              label: t("unitValue"),
              required: true,
              numeric: true,
            })}
          </CollapsibleSection>

          <div>
            <Button type="submit">{t("createPlan")}</Button>
          </div>
        </FieldSet>
      </form>

      {saved === undefined ? null : (
        <RowWriteRegion key={saved.planId} mutationRef={releaseCountPlanRef}>
          {({ submit: release, busy: releasing, state: releaseState }) =>
            releaseState.kind === "SAVED" ? null : (
              <Notice
                tone="success"
                title={t("planCreated", { number: saved.planNumber })}
                body={t("planCreatedNext")}
                testId="count-plan-created"
              >
                <Button
                  type="button"
                  disabled={releasing}
                  onClick={() =>
                    release(saved.planId, (requestId) => ({
                      requestId,
                      warehouseId,
                      countPlanId: saved.planId,
                    }))
                  }
                >
                  <ListChecks aria-hidden="true" />
                  {t("releasePlan")}
                </Button>
              </Notice>
            )
          }
        </RowWriteRegion>
      )}
    </div>
  );
}

function PolicyGroup({
  controlId,
  label,
  choices,
  value,
  onChange,
  invalid,
}: {
  readonly controlId: string;
  readonly label: string;
  readonly choices: readonly PolicyChoice[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly invalid: boolean;
}) {
  const groupId = useId();
  return (
    <div
      id={controlId}
      role="group"
      aria-labelledby={`${groupId}-label`}
      tabIndex={-1}
      className="flex flex-col gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span
        id={`${groupId}-label`}
        className={`text-sm font-medium ${invalid ? "text-destructive" : "text-text"}`}
      >
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => {
          const Icon = choice.icon;
          const hintId = `${groupId}-${choice.value}-hint`;
          return (
            <button
              key={choice.value}
              type="button"
              aria-label={choice.label}
              aria-pressed={choice.value === value}
              aria-describedby={hintId}
              onClick={() => onChange(choice.value)}
              className="flex min-h-touch items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium text-muted transition outline-none hover:text-text focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:border-accent aria-pressed:bg-accent/15 aria-pressed:text-accent"
            >
              <Icon aria-hidden="true" className="size-4" />
              {choice.label}
              <span id={hintId} className="sr-only">
                {choice.hint}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
