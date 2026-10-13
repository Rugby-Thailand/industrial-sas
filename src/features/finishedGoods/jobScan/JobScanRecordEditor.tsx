"use client";

import { useId, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import { Button } from "@/components/ui/button";
import { SelectControl } from "@/components/ui/SelectControl";
import {
  Dialog,
  type DialogCompletionHandle,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import type { RefValue } from "@/lib/convex/clientRef";
import { ErrorNotice, Field, useOperation } from "../shared";
import {
  NUMBER_FIELDS,
  REQUIRED_FIELDS,
  DETAIL_FIELDS,
  TICKET_CODE_LIMITS,
  newTicket,
  hasInvalidQuantity,
  isComplete,
  toPayload,
  type TicketDraft,
} from "./ticketDraft";
import { written } from "../shared";

type Record = RefValue<typeof fgRefs.listJobScans>["items"][number];
function recordDraft(record: Record): TicketDraft {
  const values: TicketDraft["values"] = {};
  for (const field of [...REQUIRED_FIELDS, ...DETAIL_FIELDS]) {
    const value = record[field];
    if (value !== undefined) values[field] = String(value);
  }
  const ticket = newTicket("MANUAL", values);
  if (record.storageFormat) ticket.storageFormat = record.storageFormat;
  else delete ticket.storageFormat;
  return ticket;
}

export function JobScanRecordEditor({
  record,
  warehouseId,
  onClose,
}: {
  record: Record;
  warehouseId: string;
  onClose: () => void;
}) {
  const t = useTranslations("JobScan");
  const draftScope = useId();
  const completion = useRef<DialogCompletionHandle>(null);
  const closing = useRef(false);
  const op = useOperation(`${warehouseId}:ticket-correction:${record.id}`);
  const save = useMutation(fgRefs.updateJobScan);
  const [baseline, setBaseline] = useState(record);
  const [ticket, setTicket] = useState(() => recordDraft(record));
  const dirty =
    JSON.stringify(ticket.values) !==
      JSON.stringify(recordDraft(baseline).values) ||
    ticket.storageFormat !== baseline.storageFormat;
  const guard = useNavigationDraft({
    foregroundScope: draftScope,
    dirty,
    pending: op.busy,
    discard: () => {
      setTicket(recordDraft(record));
    },
  });
  const history = useQuery(fgRefs.listJobScanCorrections, {
    warehouseId,
    jobScanId: record.id,
  });
  const stale = record.version !== baseline.version;
  const close = () => {
    if (!op.busy && !closing.current)
      guard.requestTransition(() => {
        closing.current = true;
        completion.current?.complete(onClose);
      });
  };
  async function commit() {
    if (op.busy || stale || !isComplete(ticket) || hasInvalidQuantity(ticket))
      return;
    const { source: _source, ...fields } = toPayload(ticket);
    const args = {
      warehouseId,
      jobScanId: record.id,
      expectedVersion: baseline.version,
      fields,
    };
    await op.run(
      async () =>
        written(
          await save({ ...args, requestId: op.request(JSON.stringify(args)) }),
        ),
      () => {
        guard.settle();
        op.complete(() => {
          closing.current = true;
          completion.current?.complete(onClose);
        });
      },
    );
  }
  return (
    <Dialog
      draftScope={draftScope}
      completionRef={completion}
      backPending={op.busy}
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        size="lg"
        closeLabel={t("cancel")}
        showCloseButton={!op.busy}
      >
        <DialogHeader>
          <DialogTitle>{t("editRecordTitle")}</DialogTitle>
          <DialogDescription>{t("editRecordDescription")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void commit();
          }}
          className="space-y-4"
        >
          {stale && (
            <div role="alert" className="space-y-2">
              <p>{t("recordConflict")}</p>
              <Button
                type="button"
                variant="outline"
                disabled={op.busy}
                onClick={() => {
                  setBaseline(record);
                  setTicket(recordDraft(record));
                  op.setError("");
                  op.clearRequests();
                }}
              >
                {t("reloadRecord")}
              </Button>
            </div>
          )}
          <fieldset disabled={op.busy} className="grid gap-3 sm:grid-cols-2">
            {[...REQUIRED_FIELDS, ...DETAIL_FIELDS].map((field) => (
              <Field
                key={field}
                label={t(field)}
                value={ticket.values[field] ?? ""}
                required={REQUIRED_FIELDS.includes(
                  field as (typeof REQUIRED_FIELDS)[number],
                )}
                maxLength={
                  field in TICKET_CODE_LIMITS
                    ? TICKET_CODE_LIMITS[
                        field as keyof typeof TICKET_CODE_LIMITS
                      ]
                    : 500
                }
                type={NUMBER_FIELDS.has(field) ? "number" : "text"}
                {...(NUMBER_FIELDS.has(field) ? { min: 0, step: "any" } : {})}
                onChange={(value) =>
                  setTicket((current) => ({
                    ...current,
                    values: { ...current.values, [field]: value },
                  }))
                }
              />
            ))}
            <SelectControl
              label={t("storageFormat")}
              value={ticket.storageFormat ?? "UNSET"}
              onValueChange={(value) =>
                setTicket((current) => {
                  const next = { ...current };
                  if (value === "UNSET") delete next.storageFormat;
                  else
                    next.storageFormat = value as NonNullable<
                      TicketDraft["storageFormat"]
                    >;
                  return next;
                })
              }
              options={[
                { value: "UNSET", label: t("formatUnset") },
                ...(["PALLET", "BOX", "OTHER"] as const).map((value) => ({
                  value,
                  label: t(`format.${value}`),
                })),
              ]}
              placeholder={t("formatUnset")}
              emptyLabel={t("formatUnset")}
            />
          </fieldset>
          <ErrorNotice message={op.error} />
          {history?.ok && history.value && history.value.items.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">
                {t("correctionHistory")}
              </summary>
              <ul className="mt-2 max-h-48 space-y-3 overflow-auto">
                {history.value.items.map((item) => (
                  <li key={item.id}>
                    <time dateTime={new Date(item.at).toISOString()}>
                      {new Date(item.at).toLocaleString()}
                    </time>
                    <ul>
                      {item.changes.map((change) => (
                        <li key={change.field}>
                          {t(change.field as (typeof REQUIRED_FIELDS)[number])}:{" "}
                          {String(change.from ?? "—")} →{" "}
                          {String(change.to ?? "—")}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {!history.value.complete && <p>{t("recentCorrections")}</p>}
            </details>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={op.busy}
              onClick={close}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                op.busy ||
                stale ||
                !dirty ||
                !isComplete(ticket) ||
                hasInvalidQuantity(ticket)
              }
            >
              {op.busy ? t("saving") : t("saveCorrection")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
