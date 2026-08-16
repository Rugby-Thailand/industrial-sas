"use client";

import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { PrivateFileUpload } from "@/components/files/PrivateFileUpload";
import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/ui/SelectControl";
import { MasterDataPanel } from "@/features/masterData/MasterDataPanel";
import {
  attachMasterCardFileRef,
  authorizeMasterCardFileUploadRef,
  listMasterCardFilesRef,
  listMasterCardRevisionsRef,
  listMasterCardsRef,
  requestMasterCardFileAccessRef,
  type MasterCardFileRow,
  type MasterCardRevisionRow,
  type MasterCardRow,
} from "@/lib/convex/orderToShipApi";
import { newRequestId } from "@/lib/convex/writeState";
import {
  acceptedTypesFor,
  maximumInputBytesFor,
  optimizeUpload,
} from "@/lib/files/optimizeUpload";
import { useUploadThing } from "@/lib/uploadthing/client";

import { EngineeringWorkflowActions } from "./WorkflowActionForms";
import { MasterCardRevisionDraftForm } from "./MasterCardDraftForm";

const PAGE_SIZE = 20;

const previewCards = (): readonly MasterCardRow[] => [
  {
    masterCardId: "prv_mc_gold_991",
    cardNumber: "MC-00991",
    customerId: "prv_customer_gold",
    customerProductCode: "GOLD-BOX-991",
    designKey: "RSC|300x200x150|KA125/C/KA125|C2",
    name: "Export carton",
    status: "ACTIVE",
    releasedRevisionId: "prv_rev_4",
  },
];

export function EngineeringMasterCardLibrary() {
  const t = useTranslations("OrderToShip");
  return (
    <section className="space-y-3" aria-labelledby="master-card-library-title">
      <div>
        <h3 id="master-card-library-title" className="font-bold text-text">
          {t("masterCardLibrary")}
        </h3>
        <p className="mt-1 text-sm text-muted">
          {t("masterCardLibraryDetail")}
        </p>
      </div>
      <MasterDataPanel<
        MasterCardRow,
        {
          maxPageSize?: number;
          cursor?: string;
          status?: MasterCardRow["status"];
        }
      >
        queryRef={listMasterCardsRef}
        scope="ORG"
        buildArgs={({ cursor }) => ({
          maxPageSize: PAGE_SIZE,
          ...(cursor === undefined ? {} : { cursor }),
        })}
        previewRowsFor={previewCards}
        paginationLabel={t("masterCardPagination")}
        renderRows={(rows) => (
          <ul className="grid gap-3">
            {rows.map((card) => (
              <MasterCardItem key={card.masterCardId} card={card} />
            ))}
          </ul>
        )}
      />
    </section>
  );
}

function MasterCardItem({ card }: { readonly card: MasterCardRow }) {
  const t = useTranslations("OrderToShip");
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-border-strong bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-bold text-text">
            {card.cardNumber} · {card.name}
          </h4>
          <p className="mt-1 text-sm text-muted">{card.customerProductCode}</p>
        </div>
        <code className="rounded bg-raised px-2 py-1 text-xs text-text">
          {card.masterCardId}
        </code>
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-3"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? t("hideRevisionHistory") : t("showRevisionHistory")}
      </Button>
      {open ? <RevisionHistory card={card} /> : null}
    </li>
  );
}

function RevisionHistory({ card }: { readonly card: MasterCardRow }) {
  const environment = useAppEnvironment();
  const t = useTranslations("OrderToShip");
  if (environment.previewMode) {
    return (
      <div className="mt-4 rounded border border-border bg-raised p-3 text-sm text-muted">
        {t("previewRevisionHistory")}
      </div>
    );
  }
  if (!environment.backendConfigured) {
    return <LedgerPanelStatus state={{ kind: "BACKEND_MISSING" }} />;
  }
  if (!environment.identityConfigured) {
    return <LedgerPanelStatus state={{ kind: "SIGN_IN_REQUIRED" }} />;
  }
  return <ServerRevisionHistory card={card} />;
}

function ServerRevisionHistory({ card }: { readonly card: MasterCardRow }) {
  const t = useTranslations("OrderToShip");
  return (
    <div className="mt-4">
      <MasterDataPanel<
        MasterCardRevisionRow,
        {
          masterCardId: string;
          maxPageSize?: number;
          cursor?: string;
          status?: MasterCardRevisionRow["status"];
        }
      >
        queryRef={listMasterCardRevisionsRef}
        scope="ORG"
        buildArgs={({ cursor }) => ({
          masterCardId: card.masterCardId,
          maxPageSize: PAGE_SIZE,
          ...(cursor === undefined ? {} : { cursor }),
        })}
        previewRowsFor={() => []}
        paginationLabel={t("revisionPagination")}
        renderRows={(revisions) => (
          <ol className="grid gap-4">
            {revisions.map((revision, index) => (
              <RevisionCard
                key={revision.masterCardRevisionId}
                revision={revision}
                {...(revisions[index - 1] === undefined
                  ? {}
                  : { previous: revisions[index - 1]! })}
              />
            ))}
          </ol>
        )}
      />
    </div>
  );
}

function RevisionCard({
  revision,
  previous,
}: {
  readonly revision: MasterCardRevisionRow;
  readonly previous?: MasterCardRevisionRow;
}) {
  const t = useTranslations("OrderToShip");
  const spec = revision.specification;
  const changed =
    previous === undefined ? [] : specificationChanges(previous, revision);
  const [toolsOpen, setToolsOpen] = useState(false);
  return (
    <li className="rounded-md border border-border bg-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="font-bold text-text">
          R{revision.revisionNumber} · {t(`status.${revision.status}`)}
        </h5>
        <code className="text-xs text-muted">
          {revision.masterCardRevisionId}
        </code>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <Fact label={t("styleCode")} value={spec.styleCode} />
        <Fact label={t("boardGrade")} value={spec.boardGrade} />
        <Fact
          label={t("dimensions")}
          value={`${spec.internalLengthMm} × ${spec.internalWidthMm} × ${spec.internalHeightMm} mm`}
        />
      </dl>
      <div className="mt-3 text-sm text-muted">
        {previous === undefined ? (
          revision.revisionNumber === 1 ? (
            t("firstRevision")
          ) : (
            t("previousRevisionOnEarlierPage")
          )
        ) : changed.length === 0 ? (
          t("noStructuralChanges")
        ) : (
          <ul className="grid gap-2">
            {changed.map((change) => (
              <li
                key={change.field}
                className="rounded border border-border bg-surface p-2"
              >
                <strong className="text-text">{change.field}</strong>
                <span className="mt-1 block break-words">
                  {change.before} → {change.after}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {revision.status === "RELEASED" || revision.status === "SUPERSEDED" ? (
        <details className="mt-3">
          <summary className="min-h-touch cursor-pointer py-2 font-semibold text-text">
            {t("draftChangedRevision")}
          </summary>
          <MasterCardRevisionDraftForm
            masterCardId={revision.masterCardId}
            specification={revision.specification}
          />
        </details>
      ) : null}
      <div className="mt-3">
        <Button
          type="button"
          variant="outline"
          aria-expanded={toolsOpen}
          onClick={() => setToolsOpen((current) => !current)}
        >
          {t("revisionActionsAndFiles")}
        </Button>
        {toolsOpen ? (
          <div className="grid gap-4 pt-3">
            <EngineeringWorkflowActions
              mode="revision"
              masterCardRevisionId={revision.masterCardRevisionId}
              revisionStatus={revision.status}
            />
            <RevisionFiles
              revisionId={revision.masterCardRevisionId}
              editable={revision.status === "DRAFT"}
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}

const specificationChanges = (
  previous: MasterCardRevisionRow,
  current: MasterCardRevisionRow,
): readonly {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}[] => {
  const before = previous.specification as unknown as Readonly<
    Record<string, unknown>
  >;
  const after = current.specification as unknown as Readonly<
    Record<string, unknown>
  >;
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter(
      (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
    )
    .map((field) => ({
      field,
      before: displayComparisonValue(before[field]),
      after: displayComparisonValue(after[field]),
    }));
};

const displayComparisonValue = (value: unknown): string =>
  value === undefined
    ? "—"
    : typeof value === "string"
      ? value
      : JSON.stringify(value);

function RevisionFiles({
  revisionId,
  editable,
}: {
  readonly revisionId: string;
  readonly editable: boolean;
}) {
  const t = useTranslations("OrderToShip");
  const files = useQuery(listMasterCardFilesRef, {
    masterCardRevisionId: revisionId,
    maxPageSize: 20,
  });
  const authorize = useMutation(authorizeMasterCardFileUploadRef);
  const attach = useMutation(attachMasterCardFileRef);
  const [fileKey, setFileKey] = useState("DIELINE-1");
  const [kind, setKind] = useState<"DIELINE" | "ARTWORK" | "PHOTO" | "OTHER">(
    "DIELINE",
  );
  const [selected, setSelected] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const kindControlId = `master-card-file-kind-${revisionId}`;
  const { startUpload, isUploading } = useUploadThing("masterCardFile", {
    onUploadProgress: setProgress,
  });

  const upload = async () => {
    if (selected === null || fileKey.trim().length === 0 || busy) return;
    setBusy(true);
    setProgress(0);
    setNotice(kind === "PHOTO" ? t("optimizingFile") : t("uploadingFile"));
    try {
      const prepared = await optimizeUpload(selected, kind);
      setNotice(
        prepared.optimized
          ? t("fileOptimized", {
              before: formatFileSize(prepared.originalBytes),
              after: formatFileSize(prepared.file.size),
            })
          : t("uploadingFile"),
      );
      const authorization = await authorize({
        masterCardRevisionId: revisionId,
        transport: "UPLOADTHING",
      });
      if (!authorization.ok || !("uploadGrantId" in authorization.value)) {
        throw new Error("UPLOAD_AUTHORIZATION_REFUSED");
      }
      const uploads = await startUpload([prepared.file], {
        grantId: authorization.value.uploadGrantId,
        contentDigest: prepared.contentDigest,
      });
      const verified = uploads?.[0]?.serverData;
      if (verified === null || verified === undefined) {
        throw new Error("UPLOAD_VERIFICATION_FAILED");
      }
      const attached = await attach({
        requestId: newRequestId(),
        masterCardRevisionId: revisionId,
        fileKey: fileKey.trim(),
        fileName: prepared.file.name,
        kind,
        contentType: verified.contentType,
        byteSize: verified.byteSize,
        contentDigest: verified.contentDigest,
        uploadThingKey: verified.providerKey,
        uploadGrantId: authorization.value.uploadGrantId,
      });
      if (!attached.ok || !attached.value.written) {
        throw new Error("ATTACH_FAILED");
      }
      setNotice(t("fileAttached"));
      setSelected(null);
      setResetKey((current) => current + 1);
    } catch {
      setNotice(t("fileUploadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const rows = files?.ok && files.value.ok ? files.value.items : [];
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h6 className="font-bold text-text">{t("privateRevisionFiles")}</h6>
      {editable ? (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-text">
              {t("fileKey")}
              <Input
                value={fileKey}
                onChange={(event) => setFileKey(event.target.value)}
              />
            </label>
            <div className="text-sm text-text">
              <label htmlFor={kindControlId}>{t("fileKind")}</label>
              <SelectControl
                id={kindControlId}
                value={kind}
                onValueChange={(value) => {
                  setKind(value as typeof kind);
                  setSelected(null);
                  setResetKey((current) => current + 1);
                }}
                placeholder={t("fileKind")}
                emptyLabel={t("notProvided")}
                options={(
                  ["DIELINE", "ARTWORK", "PHOTO", "OTHER"] as const
                ).map((value) => ({ value, label: value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <PrivateFileUpload
                accept={acceptedTypesFor(kind)}
                maxSize={maximumInputBytesFor(kind)}
                disabled={busy || isUploading}
                resetKey={resetKey}
                labels={{
                  drop: t("dropPrivateFile"),
                  browse: t("choosePrivateFile"),
                  limit: t("privateFileLimit", {
                    size: formatFileSize(maximumInputBytesFor(kind)),
                  }),
                  remove: t("removeSelectedFile"),
                  invalid: t("invalidPrivateFile"),
                }}
                onFileChange={setSelected}
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={busy || isUploading || selected === null}
              onClick={() => void upload()}
            >
              {t("uploadAndAttach")}
            </Button>
            <span role="status" className="text-sm text-muted">
              {isUploading && progress > 0
                ? `${notice} ${Math.round(progress)}%`
                : notice}
            </span>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">{t("releasedFilesReadOnly")}</p>
      )}
      <ul className="mt-4 grid gap-2">
        {rows.map((file) => (
          <RevisionFileRow key={file.masterCardFileId} file={file} />
        ))}
      </ul>
    </section>
  );
}

function RevisionFileRow({ file }: { readonly file: MasterCardFileRow }) {
  const t = useTranslations("OrderToShip");
  const access = useMutation(requestMasterCardFileAccessRef);
  const [notice, setNotice] = useState("");
  const open = async () => {
    const outcome = await access({ masterCardFileId: file.masterCardFileId });
    if (outcome.ok && outcome.value.granted) {
      window.open(outcome.value.url, "_blank", "noopener,noreferrer");
      setNotice(t("downloadGrantOpened"));
    } else {
      setNotice(t("fileAccessFailed"));
    }
  };
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-raised p-3 text-sm">
      <span className="text-text">
        <strong>{file.fileName}</strong> · {file.kind} ·{" "}
        {file.byteSize.toLocaleString()} B
      </span>
      <div className="flex items-center gap-2">
        <span role="status" className="text-xs text-muted">
          {notice}
        </span>
        <Button type="button" variant="outline" onClick={() => void open()}>
          {t("download")}
        </Button>
      </div>
    </li>
  );
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function Fact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-text">{value}</dd>
    </div>
  );
}
