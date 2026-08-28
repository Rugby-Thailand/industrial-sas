"use client";

import {
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  ClipboardCheck,
  GitBranch,
  MapPinCheck,
  PackageSearch,
  Ruler,
  Scale,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/utils";

type PutawayCase =
  | "MEASURED_AREA"
  | "MEASURED_EXACT"
  | "MEASURED_BLOCKED"
  | "PACKAGE_PROFILE"
  | "UNKNOWN";

type FlowTone = "success" | "warning" | "danger" | "accent";

interface CaseDefinition {
  readonly id: PutawayCase;
  readonly icon: ComponentType<{ readonly className?: string }>;
  readonly badgeTone: BadgeTone;
  readonly flowTone: FlowTone;
}

const CASES: readonly CaseDefinition[] = [
  {
    id: "MEASURED_AREA",
    icon: Ruler,
    badgeTone: "success",
    flowTone: "success",
  },
  {
    id: "MEASURED_EXACT",
    icon: MapPinCheck,
    badgeTone: "accent",
    flowTone: "accent",
  },
  {
    id: "MEASURED_BLOCKED",
    icon: ShieldCheck,
    badgeTone: "danger",
    flowTone: "danger",
  },
  {
    id: "PACKAGE_PROFILE",
    icon: PackageSearch,
    badgeTone: "warning",
    flowTone: "warning",
  },
  {
    id: "UNKNOWN",
    icon: AlertTriangle,
    badgeTone: "warning",
    flowTone: "warning",
  },
];

const STEP_ICONS = [
  ScanLine,
  Ruler,
  ShieldCheck,
  GitBranch,
  ClipboardCheck,
] as const;

const CHECKLISTS = ["hardFilters", "ranking", "commit"] as const;

export function FinishedGoodsPutawayFlow() {
  const t = useTranslations("FinishedGoodsPutawayFlow");
  const [selectedCase, setSelectedCase] =
    useState<PutawayCase>("MEASURED_AREA");
  const definition =
    CASES.find((candidate) => candidate.id === selectedCase) ?? CASES[0]!;

  return (
    <section
      aria-labelledby="fg-putaway-flow-title"
      className="mb-8 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5"
      data-testid="fg-putaway-flow"
    >
      <header className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-primary">
            <GitBranch aria-hidden="true" className="size-5" />
            <span className="text-xs font-semibold tracking-wider uppercase">
              {t("eyebrow")}
            </span>
          </div>
          <h2
            id="fg-putaway-flow-title"
            className="mt-2 text-xl font-semibold text-text"
          >
            {t("title")}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {t("description")}
          </p>
        </div>
        <StatusBadge
          tone={definition.badgeTone}
          label={t(`cases.${selectedCase}.confidence`)}
        />
      </header>

      <div
        role="group"
        aria-label={t("caseChooser")}
        className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5"
      >
        {CASES.map((candidate) => {
          const Icon = candidate.icon;
          const selected = selectedCase === candidate.id;
          return (
            <Button
              key={candidate.id}
              type="button"
              variant={selected ? "secondary" : "outline"}
              aria-pressed={selected}
              className={cn(
                "h-auto min-h-touch justify-start gap-3 px-3 py-3 text-left whitespace-normal",
                selected && "border-primary/50 bg-primary/10",
              )}
              onClick={() => setSelectedCase(candidate.id)}
            >
              <Icon aria-hidden="true" className="size-5 shrink-0" />
              <span>
                <span className="block font-semibold">
                  {t(`cases.${candidate.id}.title`)}
                </span>
                <span className="mt-0.5 block text-xs font-normal text-muted">
                  {t(`cases.${candidate.id}.summary`)}
                </span>
              </span>
            </Button>
          );
        })}
      </div>

      <div aria-live="polite" className="mt-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusBadge
            tone={definition.badgeTone}
            label={t(`cases.${selectedCase}.outcome`)}
          />
          <p className="text-sm text-muted">
            {t(`cases.${selectedCase}.operatorInstruction`)}
          </p>
        </div>

        <ol className="mx-auto max-w-4xl" aria-label={t("flowLabel")}>
          {STEP_ICONS.map((Icon, index) => {
            const step = index + 1;
            return (
              <li key={step} className="flex flex-col items-center">
                <Card
                  size="sm"
                  className={cn(
                    "w-full border-l-4",
                    definition.flowTone === "success" && "border-l-success",
                    definition.flowTone === "warning" && "border-l-warning",
                    definition.flowTone === "danger" && "border-l-danger",
                    definition.flowTone === "accent" && "border-l-primary",
                  )}
                >
                  <CardHeader className="grid-cols-[auto_1fr] items-center gap-x-3">
                    <span className="row-span-2 flex size-10 items-center justify-center rounded-lg bg-raised text-primary">
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    <CardTitle>
                      {t("stepNumber", { step })} ·{" "}
                      {t(`cases.${selectedCase}.steps.${String(step)}.title`)}
                    </CardTitle>
                    <p className="text-sm leading-relaxed text-muted">
                      {t(`cases.${selectedCase}.steps.${String(step)}.detail`)}
                    </p>
                  </CardHeader>
                </Card>
                {step === STEP_ICONS.length ? null : (
                  <ArrowDown
                    aria-hidden="true"
                    className="my-1.5 size-5 text-muted"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        {CHECKLISTS.map((checklist, index) => {
          const Icon =
            [ShieldCheck, Scale, ClipboardCheck][index] ?? CheckCircle2;
          return (
            <Card key={checklist} size="sm">
              <CardHeader className="grid-cols-[auto_1fr] items-center gap-x-3">
                <Icon aria-hidden="true" className="size-5 text-primary" />
                <CardTitle>{t(`checklists.${checklist}.title`)}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm leading-relaxed text-muted">
                  {[1, 2, 3].map((item) => (
                    <li key={item} className="flex gap-2">
                      <CheckCircle2
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-success"
                      />
                      <span>
                        {t(`checklists.${checklist}.items.${String(item)}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
