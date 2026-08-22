"use client";

/**
 * Import a spreadsheet: check it, then write it in chunks.
 *
 * The screen is two steps because the server is two steps, and the split is the
 * safety property rather than a layout choice. `previewPurchaseOrderImport` is a
 * **query** — it parses and cannot write — so what the operator approves is a
 * parse whose only effect was to produce the list they are reading.
 *
 * ### The progress counter is derived, never accumulated
 *
 * A chunk answers with a cursor. The screen stores that cursor and nothing else:
 * "written so far" is the cursor, and "how many remain" is the accepted count
 * minus it. A separately accumulated counter would drift the moment a chunk was
 * replayed after a reconnect — which is exactly when an operator is watching it
 * most closely.
 *
 * The resume path is therefore free: the cursor is the whole of the state, so a
 * reload with the same file and the same batch reference picks up where it left
 * off, and re-pressing a chunk that already wrote skips every row it recognises.
 */
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  ImportAcceptedTable,
  ImportRejectedTable,
} from "@/components/inbound/InboundTables";
import { EntityForm } from "@/components/masterData/EntityForm";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import {
  previewPurchaseOrderImportRef,
  type ImportPreviewOutcome,
} from "@/lib/convex/inboundApi";

import { ImportChunkForm, InboundSectionHeading } from "./ImportWorkbenchParts";

interface Request {
  readonly batchRef: string;
  readonly text: string;
}

export function ImportWorkbench() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => <ReadyImportWorkbench warehouseId={warehouseId} />}
    </QueryGate>
  );
}

function ReadyImportWorkbench({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const t = useTranslations("Purchasing");
  const writeT = useTranslations("Write");
  const [request, setRequest] = useState<Request | undefined>(undefined);
  const [cursor, setCursor] = useState(0);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        {/*
         * One step, three labels, each saying a different thing: the heading
         * names the step ("check the file"), the form names what it is asking
         * for ("the file to check"), and the button names what pressing it does
         * ("parse without writing"). All three were the same sentence, which is
         * the P2 finding — and the button in particular was the one that had to
         * change, because "Check the file" on a control does not say that the
         * step is a query that cannot write.
         */}
        <InboundSectionHeading title={t("importPreview")} />
        <EntityForm
          testId="form-import-preview"
          legend={t("importPreviewLegend")}
          description={t("importPreviewDescription")}
          submitLabel={t("importPreviewSubmit")}
          requiredMessage={writeT("required")}
          busy={false}
          fields={[
            {
              name: "batchRef",
              label: t("importBatchRef"),
              kind: "text",
              required: true,
              monospace: true,
              hint: t("importBatchRefHint"),
              initialValue: "BATCH-1",
            },
            {
              name: "text",
              label: t("importText"),
              kind: "textarea",
              required: true,
              monospace: true,
              hint: t("importTextHint"),
              initialValue: "",
            },
          ]}
          onSubmit={(values) => {
            setCursor(0);
            setRequest({
              batchRef: values["batchRef"] ?? "",
              text: values["text"] ?? "",
            });
          }}
        />
      </section>

      {request === undefined ? (
        <Notice
          tone="muted"
          title={t("noPreviewYet")}
          body={t("noPreviewYetHint")}
          testId="import-no-preview"
        />
      ) : (
        <ImportResult
          warehouseId={warehouseId}
          request={request}
          cursor={cursor}
          onAdvance={setCursor}
        />
      )}
    </div>
  );
}

function ImportResult({
  warehouseId,
  request,
  cursor,
  onAdvance,
}: {
  readonly warehouseId: string;
  readonly request: Request;
  readonly cursor: number;
  readonly onAdvance: (next: number) => void;
}) {
  return (
    <ServerImportResult
      warehouseId={warehouseId}
      request={request}
      cursor={cursor}
      onAdvance={onAdvance}
    />
  );
}

function ServerImportResult({
  warehouseId,
  request,
  cursor,
  onAdvance,
}: {
  readonly warehouseId: string;
  readonly request: Request;
  readonly cursor: number;
  readonly onAdvance: (next: number) => void;
}) {
  const outcome = useQuery(previewPurchaseOrderImportRef, {
    warehouseId,
    batchRef: request.batchRef,
    text: request.text,
  });

  if (outcome === undefined) {
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  }
  if (!outcome.ok) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  }
  return (
    <ImportResultBody
      outcome={outcome.value}
      request={request}
      cursor={cursor}
      onAdvance={onAdvance}
    />
  );
}

function ImportResultBody({
  outcome,
  request,
  cursor,
  onAdvance,
}: {
  readonly outcome: ImportPreviewOutcome;
  readonly request: Request;
  readonly cursor: number;
  readonly onAdvance: (next: number) => void;
}) {
  const t = useTranslations("Purchasing");
  if (!outcome.ok) {
    // A whole-file refusal: a missing header column, an unterminated quote, a
    // file past the row bound. The code is what an operator quotes.
    return (
      <Notice
        tone="danger"
        role="alert"
        title={t("importEmpty")}
        testId="import-file-refused"
      >
        <code className="rounded bg-raised px-2 py-1 font-mono text-xs">
          {outcome.error.code}
        </code>
      </Notice>
    );
  }

  const total = outcome.accepted.length;
  const remaining = Math.max(0, total - cursor);
  const complete = total > 0 && remaining === 0;

  return (
    <div className="flex flex-col gap-8" data-testid="import-result">
      <section className="flex flex-col gap-4">
        <InboundSectionHeading
          title={t("importAcceptedCaption", { count: total })}
        />
        {outcome.empty ? (
          <Notice
            tone="warning"
            title={t("importEmpty")}
            testId="import-empty"
          />
        ) : (
          <ImportAcceptedTable rows={outcome.accepted} />
        )}
      </section>

      {/*
       * The rejected rows are always rendered when there are any, above the
       * write control rather than below it: an operator about to write 300 rows
       * needs to see the 4 that will be skipped *before* they press.
       */}
      {outcome.rejected.length === 0 ? null : (
        <section className="flex flex-col gap-4">
          <InboundSectionHeading
            title={t("importRejectedCaption", {
              count: outcome.rejected.length,
            })}
          />
          <ImportRejectedTable rows={outcome.rejected} />
        </section>
      )}

      {outcome.empty ? null : (
        <section className="flex flex-col gap-4">
          <InboundSectionHeading title={t("importApplyLegend")} />
          <Notice
            tone={complete ? "success" : "accent"}
            title={
              complete
                ? t("importComplete")
                : t("importProgress", { applied: cursor, total })
            }
            testId="import-progress"
          />
          {complete ? null : (
            <ImportChunkForm
              batchRef={request.batchRef}
              text={request.text}
              cursor={cursor}
              total={total}
              onAdvance={onAdvance}
            />
          )}
        </section>
      )}
    </div>
  );
}
