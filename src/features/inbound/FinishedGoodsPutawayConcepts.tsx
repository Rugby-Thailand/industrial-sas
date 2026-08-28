"use client";

import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Columns3,
  Eye,
  Factory,
  Layers3,
  Map,
  MapPin,
  Route,
  Ruler,
  ScanLine,
  UserRound,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Concept = "GUIDED" | "COMPARE" | "MAP";
type MeasurementState = "MEASURED" | "UNMEASURED";
type CandidateId = "BULK_A" | "FG_EAST" | "OVERFLOW";

interface Candidate {
  readonly id: CandidateId;
  readonly code: string;
  readonly rank: number;
  readonly score: number;
  readonly freeArea: string;
  readonly sameProductionOrder: number;
  readonly sameCustomerOrder: number;
  readonly sameCustomer: number;
  readonly tone: BadgeTone;
  readonly position: {
    readonly left: string;
    readonly top: string;
    readonly width: string;
    readonly height: string;
  };
}

const CONCEPTS: readonly Concept[] = ["GUIDED", "COMPARE", "MAP"];

const DEFAULT_CANDIDATE: Candidate = {
  id: "BULK_A",
  code: "BULK-A",
  rank: 1,
  score: 860,
  freeArea: "18.4 m²",
  sameProductionOrder: 6,
  sameCustomerOrder: 10,
  sameCustomer: 18,
  tone: "success",
  position: { left: "11%", top: "18%", width: "37%", height: "31%" },
};

const CANDIDATES: readonly Candidate[] = [
  DEFAULT_CANDIDATE,
  {
    id: "FG_EAST",
    code: "FG-EAST",
    rank: 2,
    score: 710,
    freeArea: "31.2 m²",
    sameProductionOrder: 0,
    sameCustomerOrder: 4,
    sameCustomer: 12,
    tone: "accent",
    position: { left: "57%", top: "15%", width: "31%", height: "27%" },
  },
  {
    id: "OVERFLOW",
    code: "FG-OVERFLOW",
    rank: 3,
    score: 480,
    freeArea: "unknown",
    sameProductionOrder: 0,
    sameCustomerOrder: 0,
    sameCustomer: 2,
    tone: "warning",
    position: { left: "48%", top: "59%", width: "39%", height: "25%" },
  },
];

export function FinishedGoodsPutawayConcepts() {
  const t = useTranslations("FinishedGoodsPutawayPrototype");
  const [concept, setConcept] = useState<Concept>("GUIDED");
  const [measurement, setMeasurement] = useState<MeasurementState>("MEASURED");
  const [selectedId, setSelectedId] = useState<CandidateId>("BULK_A");
  const [scanReady, setScanReady] = useState(false);
  const tabRefs = useRef<Partial<Record<Concept, HTMLButtonElement | null>>>(
    {},
  );
  const selected =
    CANDIDATES.find((candidate) => candidate.id === selectedId) ??
    DEFAULT_CANDIDATE;

  const chooseConcept = (next: Concept) => {
    setConcept(next);
    setScanReady(false);
  };
  const chooseMeasurement = (next: MeasurementState) => {
    setMeasurement(next);
    setScanReady(false);
  };
  const chooseCandidate = (next: CandidateId) => {
    setSelectedId(next);
    setScanReady(false);
  };
  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: Concept,
  ) => {
    const index = CONCEPTS.indexOf(current);
    let next: Concept | undefined;
    if (event.key === "ArrowRight") {
      next = CONCEPTS[(index + 1) % CONCEPTS.length];
    }
    if (event.key === "ArrowLeft") {
      next = CONCEPTS[(index - 1 + CONCEPTS.length) % CONCEPTS.length];
    }
    if (event.key === "Home") next = CONCEPTS[0];
    if (event.key === "End") next = CONCEPTS.at(-1);
    if (next === undefined) return;
    event.preventDefault();
    chooseConcept(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <section
      aria-labelledby="fg-putaway-prototype-title"
      className="mb-10 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
      data-testid="fg-putaway-prototype"
    >
      <header className="border-b border-border bg-card px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge tone="accent" label={t("prototypeBadge")} />
              <span className="text-xs font-medium text-muted">
                {t("prototypeNote")}
              </span>
            </div>
            <h2
              id="fg-putaway-prototype-title"
              className="text-xl font-semibold text-text sm:text-2xl"
            >
              {t("title")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {t("description")}
            </p>
          </div>

          <label className="flex min-h-touch w-fit cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2 text-sm">
            <span>
              <span className="block font-semibold text-text">
                {t(`measurement.${measurement}`)}
              </span>
              <span className="block text-xs text-muted">
                {t("measurementChooser")}
              </span>
            </span>
            <Switch
              checked={measurement === "MEASURED"}
              aria-label={t("measurementChooser")}
              onCheckedChange={(checked) =>
                chooseMeasurement(checked ? "MEASURED" : "UNMEASURED")
              }
            />
          </label>
        </div>

        <DemoHandlingUnit measurement={measurement} />

        <div
          role="tablist"
          aria-label={t("styleChooser")}
          className="mt-5 grid gap-2 md:grid-cols-3"
        >
          {CONCEPTS.map((option) => {
            const Icon =
              option === "GUIDED"
                ? Route
                : option === "COMPARE"
                  ? Columns3
                  : Map;
            return (
              <Button
                key={option}
                ref={(node) => {
                  tabRefs.current[option] = node;
                }}
                id={`fg-putaway-tab-${option.toLowerCase()}`}
                type="button"
                role="tab"
                variant={concept === option ? "secondary" : "outline"}
                tabIndex={concept === option ? 0 : -1}
                aria-selected={concept === option}
                aria-controls="fg-putaway-style-panel"
                className={cn(
                  "h-auto min-h-touch justify-start gap-3 rounded-xl p-3 text-left whitespace-normal",
                  concept === option
                    ? "border-primary/50 bg-primary/10 text-text"
                    : "text-muted",
                )}
                onClick={() => chooseConcept(option)}
                onKeyDown={(event) => onTabKeyDown(event, option)}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-current/20 bg-surface">
                  <Icon aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-semibold">
                    {t(`concept.${option}.title`)}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed">
                    {t(`concept.${option}.description`)}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
      </header>

      <div
        id="fg-putaway-style-panel"
        role="tabpanel"
        aria-labelledby={`fg-putaway-tab-${concept.toLowerCase()}`}
        tabIndex={0}
        className="p-4 sm:p-6"
      >
        {concept === "GUIDED" ? (
          <GuidedConcept
            measurement={measurement}
            selected={selected}
            onChoose={chooseCandidate}
            onScan={() => setScanReady(true)}
            onMeasure={() => chooseMeasurement("MEASURED")}
          />
        ) : concept === "COMPARE" ? (
          <CompareConcept
            measurement={measurement}
            selected={selected}
            onChoose={chooseCandidate}
            onScan={() => setScanReady(true)}
          />
        ) : (
          <MapConcept
            measurement={measurement}
            selected={selected}
            onChoose={chooseCandidate}
            onScan={() => setScanReady(true)}
          />
        )}

        <div aria-live="polite" className="mt-4 min-h-6">
          {scanReady ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-success bg-success/10 px-4 py-3 text-sm text-success">
              <ScanLine aria-hidden="true" />
              <strong>{t("scanReady", { code: selected.code })}</strong>
              <span>{t("scanReadyHint")}</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function DemoHandlingUnit({
  measurement,
}: {
  readonly measurement: MeasurementState;
}) {
  const t = useTranslations("FinishedGoodsPutawayPrototype");
  return (
    <Card size="sm" className="mt-5">
      <CardContent className="grid gap-3 lg:grid-cols-[1.3fr_repeat(3,1fr)]">
        <Fact icon={<Boxes />} label={t("lpnLabel")} value="LPN-FG-26018-07" />
        <Fact
          icon={<Factory />}
          label={t("productionOrderLabel")}
          value="FO-26018-03"
        />
        <Fact
          icon={<ClipboardList />}
          label={t("customerOrderLabel")}
          value="SO-26018"
        />
        <Fact
          icon={<UserRound />}
          label={t("customerLabel")}
          value={t("demoCustomer")}
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 lg:col-span-4">
          {measurement === "MEASURED" ? (
            <>
              <StatusBadge tone="success" label={t("measuredBadge")} />
              <span className="font-mono text-sm text-text">
                1.20 × 0.80 × 1.35 m · 420 kg
              </span>
              <span className="text-xs text-muted">{t("measuredSource")}</span>
            </>
          ) : (
            <>
              <StatusBadge tone="warning" label={t("unmeasuredBadge")} />
              <span className="text-sm text-muted">
                {t("unmeasuredSource")}
              </span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="text-accent [&_svg]:size-5" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-muted">{label}</span>
        <strong className="block truncate text-sm text-text">{value}</strong>
      </span>
    </div>
  );
}

function GuidedConcept({
  measurement,
  selected,
  onChoose,
  onScan,
  onMeasure,
}: ConceptProps & { readonly onMeasure: () => void }) {
  const t = useTranslations("FinishedGoodsPutawayPrototype");
  return (
    <div className="mx-auto max-w-3xl" data-testid="putaway-style-guided">
      <div className="overflow-hidden rounded-2xl border border-accent bg-card shadow-sm">
        <div className="border-b border-border bg-accent/10 px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-semibold text-accent">
              {t("guided.command")}
            </span>
            <StatusBadge
              tone={measurement === "MEASURED" ? "success" : "warning"}
              label={
                measurement === "MEASURED"
                  ? t("confidence.high")
                  : t("confidence.low")
              }
            />
          </div>
          <h3 className="mt-3 text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            {t("guided.takeTo", { code: selected.code })}
          </h3>
          <p className="mt-2 text-sm text-muted">
            {t(`candidate.${selected.id}.breadcrumb`)}
          </p>
        </div>

        <div className="grid gap-6 p-5 md:grid-cols-[1fr_auto] md:items-start">
          <div>
            <FitSummary measurement={measurement} candidate={selected} />
            <ReasonList candidate={selected} compact />
          </div>
          <div className="flex flex-col gap-2 md:w-56">
            <Button type="button" onClick={onScan} className="w-full">
              <ScanLine aria-hidden="true" />
              {measurement === "MEASURED"
                ? t("scanDestination")
                : t("visualConfirmAndScan")}
            </Button>
            {measurement === "UNMEASURED" ? (
              <Button type="button" variant="outline" onClick={onMeasure}>
                <Ruler aria-hidden="true" />
                {t("measureNow")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <details className="mt-4 rounded-xl border border-border bg-surface p-4">
        <summary className="cursor-pointer font-semibold text-text">
          {t("guided.alternatives")}
        </summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {CANDIDATES.filter((candidate) => candidate.id !== selected.id).map(
            (candidate) => (
              <button
                key={candidate.id}
                type="button"
                className="rounded-xl border border-border bg-card p-4 text-left hover:border-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => onChoose(candidate.id)}
              >
                <span className="flex items-center justify-between gap-3">
                  <strong>{candidate.code}</strong>
                  <span className="text-xs text-muted">
                    {t("rank", { rank: candidate.rank })}
                  </span>
                </span>
                <span className="mt-2 block text-xs leading-relaxed text-muted">
                  {t(`candidate.${candidate.id}.summary`)}
                </span>
              </button>
            ),
          )}
        </div>
      </details>
    </div>
  );
}

function CompareConcept({
  measurement,
  selected,
  onChoose,
  onScan,
}: ConceptProps) {
  const t = useTranslations("FinishedGoodsPutawayPrototype");
  return (
    <div data-testid="putaway-style-compare">
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-success bg-success/10 px-4 py-3">
        <CheckCircle2 aria-hidden="true" className="text-success" />
        <strong className="text-sm text-text">
          {t("compare.hardRulesPassed")}
        </strong>
        <span className="text-xs text-muted">{t("compare.hardRulesHint")}</span>
      </div>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-text">
          {t("compare.choose")}
        </legend>
        <div className="grid gap-4 xl:grid-cols-3">
          {CANDIDATES.map((candidate) => {
            const checked = candidate.id === selected.id;
            return (
              <label
                key={candidate.id}
                className={cn(
                  "relative flex cursor-pointer flex-col rounded-2xl border bg-card p-4 transition-colors",
                  checked
                    ? "border-accent ring-2 ring-accent/30"
                    : "border-border hover:border-border-strong",
                )}
              >
                <input
                  type="radio"
                  name="putaway-candidate"
                  value={candidate.id}
                  checked={checked}
                  className="sr-only"
                  onChange={() => onChoose(candidate.id)}
                />
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="text-xs font-semibold text-accent">
                      {t("rank", { rank: candidate.rank })}
                    </span>
                    <strong className="mt-1 block text-xl text-text">
                      {candidate.code}
                    </strong>
                    <span className="mt-1 block text-xs text-muted">
                      {t("generalAreaAddress")}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1 flex size-6 items-center justify-center rounded-full border",
                      checked
                        ? "border-accent bg-accent text-primary-foreground"
                        : "border-border-strong",
                    )}
                  >
                    {checked ? "✓" : ""}
                  </span>
                </span>

                <div className="my-4 rounded-xl border border-border bg-surface p-3">
                  <FitSummary measurement={measurement} candidate={candidate} />
                </div>

                <ReasonList candidate={candidate} compact />

                <div className="mt-auto border-t border-border pt-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs text-muted">
                      {t("compare.rankingScore")}
                    </span>
                    <strong className="font-mono text-lg text-text">
                      {candidate.score}
                    </strong>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{
                        width: `${Math.max(18, candidate.score / 10)}%`,
                      }}
                    />
                  </div>
                  <span className="mt-2 block text-[0.7rem] text-muted">
                    {t("compare.scoreDisclaimer")}
                  </span>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5 flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-raised/40 p-4 sm:flex-row sm:items-center">
        <div>
          <span className="text-xs text-muted">{t("compare.selected")}</span>
          <strong className="mt-1 block text-lg text-text">
            {selected.code}
          </strong>
        </div>
        <Button type="button" onClick={onScan}>
          <ScanLine aria-hidden="true" />
          {measurement === "MEASURED"
            ? t("scanDestination")
            : t("visualConfirmAndScan")}
        </Button>
      </div>
    </div>
  );
}

function MapConcept({ measurement, selected, onChoose, onScan }: ConceptProps) {
  const t = useTranslations("FinishedGoodsPutawayPrototype");
  return (
    <div
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]"
      data-testid="putaway-style-map"
    >
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Layers3 aria-hidden="true" className="text-accent" />
            <strong className="text-sm text-text">{t("map.floorPlan")}</strong>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted">
            <span className="rounded-full border border-success px-2 py-1">
              ✓ {t("map.verified")}
            </span>
            <span className="rounded-full border border-warning px-2 py-1">
              ◌ {t("map.needsCheck")}
            </span>
            <span className="rounded-full border border-border-strong px-2 py-1">
              PO / SO {t("map.affinity")}
            </span>
          </div>
        </div>

        <div
          aria-label={t("map.mapLabel")}
          className="relative min-h-[28rem] overflow-hidden bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:28px_28px] p-4"
        >
          <div className="absolute inset-x-[6%] inset-y-[9%] rounded-2xl border-2 border-border-strong bg-surface/75 shadow-inner" />
          <div className="absolute top-[54%] left-[8%] h-[12%] w-[32%] rounded-lg border border-dashed border-warning/70 bg-warning/10 p-2 text-xs text-warning">
            {t("map.reserved")}
          </div>
          {CANDIDATES.map((candidate) => {
            const active = selected.id === candidate.id;
            const verified =
              measurement === "MEASURED" && candidate.id !== "OVERFLOW";
            return (
              <button
                key={candidate.id}
                type="button"
                aria-label={t("map.areaLabel", {
                  code: candidate.code,
                  rank: candidate.rank,
                  status: verified ? t("fit.verified") : t("fit.unknown"),
                })}
                className={cn(
                  "absolute flex min-h-touch flex-col items-start justify-between rounded-xl border-2 p-3 text-left shadow-sm transition-all focus-visible:ring-3 focus-visible:ring-ring/50",
                  verified
                    ? "border-success bg-success/15"
                    : "border-warning bg-warning/15",
                  active && "z-10 ring-4 ring-accent/40",
                )}
                style={candidate.position}
                onClick={() => onChoose(candidate.id)}
              >
                <span className="flex w-full items-start justify-between gap-2">
                  <span className="flex size-8 items-center justify-center rounded-full bg-surface text-sm font-bold text-text shadow">
                    {candidate.rank}
                  </span>
                  <span className="flex flex-wrap justify-end gap-1">
                    {candidate.sameProductionOrder > 0 ? (
                      <span className="rounded bg-surface px-1.5 py-0.5 text-[0.65rem] font-bold text-accent">
                        PO
                      </span>
                    ) : null}
                    {candidate.sameCustomerOrder > 0 ? (
                      <span className="rounded bg-surface px-1.5 py-0.5 text-[0.65rem] font-bold text-pending">
                        SO
                      </span>
                    ) : null}
                  </span>
                </span>
                <span>
                  <strong className="block text-sm text-text">
                    {candidate.code}
                  </strong>
                  <span className="mt-1 block text-[0.7rem] text-muted">
                    {verified
                      ? `✓ ${t("fit.verified")}`
                      : `◌ ${t("fit.unknown")}`}
                  </span>
                </span>
              </button>
            );
          })}

          {measurement === "MEASURED" ? (
            <div
              aria-label={t("map.ghostFootprint")}
              className="pointer-events-none absolute z-20 flex h-12 w-20 items-center justify-center rounded border-2 border-dashed border-accent bg-accent/20 text-[0.65rem] font-semibold text-accent"
              style={{
                left: `calc(${selected.position.left} + 8%)`,
                top: `calc(${selected.position.top} + 9%)`,
              }}
            >
              1.2 × 0.8 m
            </div>
          ) : null}
        </div>
      </div>

      <aside
        className="rounded-2xl border border-accent bg-card p-5"
        aria-live="polite"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-semibold text-accent">
              {t("rank", { rank: selected.rank })}
            </span>
            <h3 className="mt-1 text-2xl font-semibold text-text">
              {selected.code}
            </h3>
            <p className="mt-1 text-xs text-muted">{t("generalAreaAddress")}</p>
          </div>
          <MapPin aria-hidden="true" className="text-accent" />
        </div>

        <div className="mt-5 rounded-xl border border-border bg-surface p-4">
          <FitSummary measurement={measurement} candidate={selected} />
        </div>
        <ReasonList candidate={selected} />

        <Button type="button" onClick={onScan} className="mt-5 w-full">
          <ScanLine aria-hidden="true" />
          {measurement === "MEASURED"
            ? t("map.confirm", { code: selected.code })
            : t("visualConfirmAndScan")}
        </Button>
      </aside>
    </div>
  );
}

function FitSummary({
  measurement,
  candidate,
}: {
  readonly measurement: MeasurementState;
  readonly candidate: Candidate;
}) {
  const t = useTranslations("FinishedGoodsPutawayPrototype");
  const measured = measurement === "MEASURED";
  const verified = measured && candidate.id !== "OVERFLOW";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {verified ? (
          <CheckCircle2 aria-hidden="true" className="size-5 text-success" />
        ) : (
          <AlertTriangle aria-hidden="true" className="size-5 text-warning" />
        )}
        <strong className="text-sm text-text">
          {verified
            ? t("fit.verified")
            : measured
              ? t("fit.estimated")
              : t("fit.unknown")}
        </strong>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        {verified
          ? t("space.verified", { area: candidate.freeArea })
          : measured && candidate.freeArea !== "unknown"
            ? t("space.estimated", { area: candidate.freeArea })
            : t("space.unknown")}
      </p>
      {!measured ? (
        <div className="flex items-center gap-2 text-xs font-medium text-warning">
          <Eye aria-hidden="true" className="size-4" />
          {t("visualConfirmationRequired")}
        </div>
      ) : null}
    </div>
  );
}

function ReasonList({
  candidate,
  compact = false,
}: {
  readonly candidate: Candidate;
  readonly compact?: boolean;
}) {
  const t = useTranslations("FinishedGoodsPutawayPrototype");
  const reasons = [
    candidate.sameProductionOrder > 0
      ? t("reason.sameProductionOrder", {
          count: candidate.sameProductionOrder,
        })
      : undefined,
    candidate.sameCustomerOrder > 0
      ? t("reason.sameCustomerOrder", { count: candidate.sameCustomerOrder })
      : undefined,
    candidate.sameCustomer > 0
      ? t("reason.sameCustomer", { count: candidate.sameCustomer })
      : undefined,
    t(`candidate.${candidate.id}.summary`),
  ].filter((reason): reason is string => reason !== undefined);

  return (
    <ul className={cn("mt-4 space-y-2", compact && "text-xs")}>
      {reasons.slice(0, compact ? 3 : 4).map((reason) => (
        <li
          key={reason}
          className="flex gap-2 text-sm leading-relaxed text-muted"
        >
          <ArrowRight
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-accent"
          />
          <span>{reason}</span>
        </li>
      ))}
    </ul>
  );
}

interface ConceptProps {
  readonly measurement: MeasurementState;
  readonly selected: Candidate;
  readonly onChoose: (candidateId: CandidateId) => void;
  readonly onScan: () => void;
}
