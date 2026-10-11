"use client";

import { useMutation, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

import {
  useDraftGuard,
  usePendingGuard,
} from "@/components/providers/draftGuard";
import { Button } from "@/components/ui/button";
import {
  CheckboxControl,
  CheckboxField,
} from "@/components/ui/CheckboxControl";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableScroller } from "@/components/ui/TableScroller";
import type { RefValue } from "@/lib/convex/clientRef";
import { hrRefs } from "@/lib/convex/hrApi";
import { HR_CODES } from "@/lib/navigation";
import { guardedNavigate } from "@/lib/navigationGuard";
import {
  PAYSLIP_CSV_HEADER,
  inspectPayslipSource,
  selectPayslipSource,
  type PayslipExclusion,
} from "../../../convex/model/hr/payslip";

import { formatBusinessDate } from "./format";
import {
  Facts,
  HrGate,
  HrInlineError,
  HrQueryState,
  SectionTitle,
  WriteFeedback,
} from "./HrShared";
import {
  preparePayslipImport,
  type PreparedPayslipImport,
} from "./payslipImport";
import { PayslipAccessError } from "./payslipClient";
import { useHrWrite } from "./useHrWrite";

type Imports = Extract<RefValue<typeof hrRefs.payslipImports>, { ok: true }>;
type Batch = Imports["items"][number];
export function HrPayslipImportScreen() {
  const t = useTranslations("Hr.payslips");
  return (
    <>
      <PageHeader
        title={t("importTitle")}
        summary={t("importSummary")}
        showBack={false}
      />
      <HrGate code={HR_CODES.admin}>
        <ImportContent />
      </HrGate>
    </>
  );
}
function ImportContent() {
  const t = useTranslations("Hr.payslips");
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const outcome = useQuery(hrRefs.payslipImports, cursor ? { cursor } : {});
  return (
    <HrQueryState outcome={outcome}>
      {() =>
        outcome?.ok ? (
          outcome.value.ok ? (
            <div className="space-y-6">
              <ImportForm hashRequired={outcome.value.hashRequired} />
              <Panel className="space-y-4">
                <SectionTitle>{t("imports")}</SectionTitle>
                {outcome.value.items.length ? (
                  <ul className="space-y-4">
                    {outcome.value.items.map((batch) => (
                      <li key={batch.id}>
                        <ImportBatch batch={batch} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title={t("noImports")} />
                )}
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    disabled={!cursors.length}
                    onClick={() =>
                      guardedNavigate(() =>
                        setCursors((previous) => previous.slice(0, -1)),
                      )
                    }
                  >
                    {t("previous")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={outcome.value.isDone}
                    onClick={() => {
                      if (outcome.value.ok) {
                        const next = outcome.value.continueCursor;
                        guardedNavigate(() =>
                          setCursors((previous) => [...previous, next]),
                        );
                      }
                    }}
                  >
                    {t("next")}
                  </Button>
                </div>
              </Panel>
            </div>
          ) : outcome.value.code === "POLICY_NOT_ACTIVE" ? (
            <Notice tone="warning" title={t("gate")} body={t("gateHint")} />
          ) : (
            <HrInlineError code={outcome.value.code} />
          )
        ) : null
      }
    </HrQueryState>
  );
}
function ImportForm({ hashRequired }: { readonly hashRequired: boolean }) {
  const t = useTranslations("Hr.payslips");
  const id = useId();
  const stage = useMutation(hrRefs.stagePayslips);
  const write = useHrWrite("payslip-import-stage");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sourceName, setSource] = useState("");
  const [csv, setCsv] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [sourceRows, setSourceRows] = useState<
    ReturnType<typeof inspectPayslipSource>
  >([]);
  const [exclusions, setExclusions] = useState<readonly PayslipExclusion[]>([]);
  const [inspecting, setInspecting] = useState(false);
  const sourceRead = useRef(0);
  const [confirmed, setConfirmed] = useState(false);
  const [prepared, setPrepared] = useState<PreparedPayslipImport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const csvInput = useRef<HTMLInputElement>(null),
    pdfInput = useRef<HTMLInputElement>(null);
  const validation = useRef(0);
  const reset = () => {
    validation.current++;
    setFrom("");
    setTo("");
    setSource("");
    setCsv(null);
    setFiles([]);
    sourceRead.current++;
    setSourceRows([]);
    setExclusions([]);
    setInspecting(false);
    setPrepared(null);
    setConfirmed(false);
    setError(null);
    setChecking(false);
    if (csvInput.current) csvInput.current.value = "";
    if (pdfInput.current) pdfInput.current.value = "";
  };
  const changed = () => {
    validation.current++;
    setPrepared(null);
    setError(null);
    setConfirmed(false);
    if (write.state.kind === "SAVED") write.reset();
  };
  const locked = write.locked || checking;
  const loadSource = async (file: File | null) => {
    const operation = ++sourceRead.current;
    setSourceRows([]);
    setExclusions([]);
    setInspecting(file !== null);
    if (!file) return;
    try {
      if (file.size > 100_000)
        throw new PayslipAccessError("PAYSLIP_SOURCE_INVALID");
      const text = await file.text();
      if (sourceRead.current !== operation) return;
      const rows = inspectPayslipSource(text);
      setSourceRows(rows);
      if (!rows.length)
        setError(
          selectPayslipSource(text).errors[0] ?? "PAYSLIP_SOURCE_INVALID",
        );
    } catch {
      if (sourceRead.current === operation) setError("PAYSLIP_SOURCE_INVALID");
    } finally {
      if (sourceRead.current === operation) setInspecting(false);
    }
  };
  useDraftGuard(
    from !== "" ||
      to !== "" ||
      sourceName !== "" ||
      csv !== null ||
      files.length > 0,
    reset,
    write.pending,
  );
  usePendingGuard(checking);
  const validate = async () => {
    if (!csv || !from || !to || from > to || !sourceName.trim()) {
      setError("PAYSLIP_SOURCE_INVALID");
      return;
    }
    const operation = ++validation.current;
    setChecking(true);
    setError(null);
    try {
      const result = await preparePayslipImport(
        csv,
        files,
        from,
        to,
        exclusions,
      );
      if (validation.current === operation) setPrepared(result);
    } catch (error) {
      if (validation.current === operation)
        setError(
          error instanceof PayslipAccessError
            ? error.code
            : "PAYSLIP_SOURCE_INVALID",
        );
    } finally {
      if (validation.current === operation) setChecking(false);
    }
  };
  const submit = async () => {
    if (!prepared || !confirmed) {
      setError("PAYSLIP_SOURCE_INVALID");
      return;
    }
    const result = await write.submit((requestId) =>
      stage({
        requestId,
        from,
        to,
        sourceName: sourceName.trim(),
        csv: prepared.csv,
        sourceConfirmed: confirmed,
        documents: [...prepared.documents],
        exclusions: prepared.exclusions.map(({ rowNumber, reason }) => ({
          rowNumber,
          reason,
        })),
      }),
    );
    if (result.kind === "SAVED") reset();
  };
  return (
    <Panel className="space-y-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
        className="space-y-4"
      >
        <fieldset
          disabled={locked}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <FormField id={`${id}-source`} label={t("sourceName")} required>
            {(field) => (
              <Input
                {...field}
                value={sourceName}
                maxLength={120}
                onChange={(event) => {
                  changed();
                  setSource(event.target.value);
                }}
              />
            )}
          </FormField>
          {(["from", "to"] as const).map((field) => (
            <FormField
              key={field}
              id={`${id}-${field}`}
              label={t(field)}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  value={field === "from" ? from : to}
                  onChange={(event) => {
                    changed();
                    (field === "from" ? setFrom : setTo)(event.target.value);
                  }}
                />
              )}
            </FormField>
          ))}
          <FormField
            id={`${id}-csv`}
            label={t("csv")}
            hint={t("csvHint")}
            required
            className="sm:col-span-2 lg:col-span-3"
          >
            {(field) => (
              <Input
                {...field}
                ref={csvInput}
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  changed();
                  const file = event.target.files?.[0] ?? null;
                  setCsv(file);
                  void loadSource(file);
                }}
              />
            )}
          </FormField>
          <FormField
            id={`${id}-pdfs`}
            label={t("pdfs")}
            hint={t("pdfHint")}
            required
            className="sm:col-span-2 lg:col-span-3"
          >
            {(field) => (
              <Input
                {...field}
                ref={pdfInput}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                onChange={(event) => {
                  changed();
                  setFiles(Array.from(event.target.files ?? []));
                }}
              />
            )}
          </FormField>
        </fieldset>
        {inspecting ? (
          <p role="status" className="text-sm text-muted">
            {t("readingSourceRows")}
          </p>
        ) : null}
        {sourceRows.length ? (
          <fieldset disabled={locked} className="space-y-3">
            <legend className="text-sm font-semibold text-text">
              {t("sourceSelection")}
            </legend>
            <p className="text-sm text-muted">{t("sourceSelectionHint")}</p>
            <ul className="divide-y divide-border">
              {sourceRows.map((row) => {
                const exclusion = exclusions.find(
                  (value) => value.rowNumber === row.rowNumber,
                );
                return (
                  <li key={row.rowNumber} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <CheckboxField
                        label={t("includeSourceRow", {
                          row: row.rowNumber,
                          employee: row.employeeCode || t("unknownEmployee"),
                        })}
                        checked={!exclusion}
                        onChange={(event) => {
                          changed();
                          setExclusions(
                            event.target.checked
                              ? exclusions.filter(
                                  (value) => value.rowNumber !== row.rowNumber,
                                )
                              : [
                                  ...exclusions,
                                  { rowNumber: row.rowNumber, reason: "" },
                                ],
                          );
                        }}
                      />
                      <StatusBadge
                        tone={
                          !exclusion
                            ? row.valid
                              ? "muted"
                              : "danger"
                            : "warning"
                        }
                        label={t(
                          !exclusion
                            ? row.valid
                              ? "sourceFormatValid"
                              : "sourceRowInvalid"
                            : "sourceRowExcluded",
                        )}
                      />
                    </div>
                    {exclusion ? (
                      <FormField
                        id={`${id}-exclude-${row.rowNumber}`}
                        label={t("exclusionReason", { row: row.rowNumber })}
                        hint={t("exclusionReasonHint")}
                        required
                      >
                        {(field) => (
                          <Input
                            {...field}
                            value={exclusion.reason}
                            minLength={3}
                            maxLength={500}
                            onChange={(event) => {
                              changed();
                              setExclusions(
                                exclusions.map((value) =>
                                  value.rowNumber === row.rowNumber
                                    ? { ...value, reason: event.target.value }
                                    : value,
                                ),
                              );
                            }}
                          />
                        )}
                      </FormField>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="text-sm text-text">
              {t("selectionCounts", {
                included: sourceRows.length - exclusions.length,
                excluded: exclusions.length,
              })}
            </p>
          </fieldset>
        ) : null}
        <code className="block overflow-x-auto rounded-md bg-raised p-3 text-xs text-muted">
          {PAYSLIP_CSV_HEADER}
        </code>
        <Button
          type="button"
          variant="outline"
          disabled={locked || inspecting}
          onClick={() => void validate()}
        >
          {t("preview")}
        </Button>
        {error ? (
          <Notice
            tone="danger"
            role="alert"
            title={t(
              error === "CSV_HEADER_INVALID"
                ? "headerInvalid"
                : error === "CSV_ROW_LIMIT"
                  ? "rowLimitInvalid"
                  : error === "PAYSLIP_CSV_INVALID"
                    ? "amountsInvalid"
                    : error === "CSV_EXCLUSIONS_INVALID"
                      ? "exclusionsInvalid"
                      : error === "PAYSLIP_DOCUMENT_MAPPING_INVALID" ||
                          error === "PAYSLIP_PDF_INVALID"
                        ? "filesInvalid"
                        : "sourceInvalid",
            )}
          />
        ) : null}
        {prepared ? (
          <div className="space-y-4">
            <p className="font-semibold text-text">
              {t("rows", { count: prepared.rows.length })}
            </p>
            <p className="text-sm text-muted">{t("verifiedFiles")}</p>
            <p className="text-xs break-all text-muted">
              {t("fingerprint")}: {prepared.sourceHash}
            </p>
            <SourceRows
              rows={prepared.rows.map((row) => ({
                employeeCode: row.code,
                employeeName: "",
                gross: row.gross,
                deductions: row.deductions,
                net: row.net,
                sourceHash:
                  prepared.documents.find(
                    (document) => document.employeeCode === row.code,
                  )?.expectedHash ?? "",
              }))}
            />
            <ExcludedSourceRows exclusions={prepared.exclusions} />
            <label className="flex min-h-touch items-start gap-3 text-sm">
              <CheckboxControl
                checked={confirmed}
                disabled={write.locked}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              {t("confirmSource")}
            </label>
            <p className="text-xs text-muted">
              {hashRequired
                ? t("fingerprintRequired")
                : t("fingerprintOptional")}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={locked || !confirmed}>
                {write.pending ? t("staging") : t("stage")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={write.locked}
                onClick={reset}
              >
                {t("reset")}
              </Button>
            </div>
          </div>
        ) : null}
        <WriteFeedback
          state={write.state}
          onRetry={() =>
            void write.retry().then((result) => {
              if (result.kind === "SAVED") reset();
            })
          }
        />
      </form>
    </Panel>
  );
}

function ImportBatch({ batch }: { readonly batch: Batch }) {
  const t = useTranslations("Hr.payslips");
  const locale = useLocale();
  const publish = useMutation(hrRefs.publishPayslips);
  const write = useHrWrite(`payslip-publish:${batch.id}`);
  const [confirmed, setConfirmed] = useState(false);
  usePendingGuard(write.pending);
  return (
    <article className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-semibold text-text">{batch.sourceName}</h3>
        <StatusBadge
          tone={batch.status === "PUBLISHED" ? "success" : "pending"}
          label={t(batch.status)}
        />
      </div>
      <Facts
        dense
        items={[
          {
            label: t("period"),
            value: `${formatBusinessDate(batch.from, locale)} – ${formatBusinessDate(batch.to, locale)}`,
          },
          {
            label: t("rows", { count: batch.rowCount }),
            value: batch.rowCount,
          },
        ]}
      />
      <p className="text-xs break-all text-muted">
        {t("fingerprint")}: {batch.sourceHash}
      </p>
      <details>
        <summary className="min-h-touch cursor-pointer text-sm text-link">
          {t("review")}
        </summary>
        <SourceRows rows={batch.rows} />
        <ExcludedSourceRows exclusions={batch.exclusions ?? []} />
      </details>
      {batch.status === "STAGED" ? (
        <div className="space-y-3">
          <label className="flex min-h-touch items-start gap-3 text-sm">
            <CheckboxControl
              checked={confirmed}
              disabled={write.locked}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {t("replacementConfirmed")}
          </label>
          <Button
            disabled={write.locked || !confirmed}
            onClick={() =>
              void write.submit((requestId) =>
                publish({
                  requestId,
                  importId: batch.id,
                  replacementConfirmed: confirmed,
                }),
              )
            }
          >
            {t("publish")}
          </Button>
        </div>
      ) : null}
      <WriteFeedback state={write.state} onRetry={() => void write.retry()} />
    </article>
  );
}
function ExcludedSourceRows({
  exclusions,
}: {
  readonly exclusions: readonly {
    rowNumber: number;
    employeeCode: string;
    reason: string;
  }[];
}) {
  const t = useTranslations("Hr.payslips");
  if (!exclusions.length) return null;
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-text">
        {t("excludedSourceRows")}
      </h4>
      <ul className="divide-y divide-border">
        {exclusions.map((row) => (
          <li key={row.rowNumber} className="py-2">
            <p className="text-sm font-medium text-text">
              {t("excludedRowLabel", {
                row: row.rowNumber,
                employee: row.employeeCode || t("unknownEmployee"),
              })}
            </p>
            <p className="text-sm wrap-anywhere whitespace-pre-wrap text-muted">
              {row.reason}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
function SourceRows({
  rows,
}: {
  readonly rows: readonly {
    employeeCode: string;
    employeeName: string;
    gross: number;
    deductions: number;
    net: number;
    sourceHash: string;
  }[];
}) {
  const t = useTranslations("Hr.payslips");
  const locale = useLocale();
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "THB",
  });
  const totals = rows.reduce(
    (sum, row) => ({
      gross: sum.gross + row.gross,
      deductions: sum.deductions + row.deductions,
      net: sum.net + row.net,
    }),
    { gross: 0, deductions: 0, net: 0 },
  );
  return (
    <div className="space-y-3">
      <TableScroller label={t("review")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("employee")}</TableHead>
              <TableHead className="text-right">{t("gross")}</TableHead>
              <TableHead className="text-right">{t("deductions")}</TableHead>
              <TableHead className="text-right">{t("net")}</TableHead>
              <TableHead>{t("fingerprint")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.employeeCode}>
                <TableCell>
                  {row.employeeCode}
                  {row.employeeName ? ` · ${row.employeeName}` : ""}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money.format(row.gross / 100)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money.format(row.deductions / 100)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money.format(row.net / 100)}
                </TableCell>
                <TableCell className="max-w-48 font-mono text-xs break-all">
                  {row.sourceHash}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroller>
      <Facts
        dense
        items={[
          { label: t("gross"), value: money.format(totals.gross / 100) },
          {
            label: t("deductions"),
            value: money.format(totals.deductions / 100),
          },
          { label: t("net"), value: money.format(totals.net / 100) },
        ]}
      />
    </div>
  );
}
