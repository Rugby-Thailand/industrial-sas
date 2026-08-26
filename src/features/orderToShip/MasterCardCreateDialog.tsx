"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { PrivateFileUpload } from "@/components/files/PrivateFileUpload";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/button";
import {
  WriteDialog,
  useWriteSurface,
} from "@/features/masterData/WriteDialog";
import { listMasterCardRevisionsRef } from "@/lib/convex/orderToShipApi";
import {
  acceptedTypesFor,
  maximumInputBytesFor,
} from "@/lib/files/optimizeUpload";
import { useIsMobile } from "@/hooks/use-mobile";

import { MasterCardDraftForm } from "./MasterCardDraftForm";
import { useMasterCardFileUpload } from "./useMasterCardFileUpload";

const documentId = (outcome: Record<string, unknown>): string | undefined => {
  const value = outcome["value"] as Record<string, unknown> | undefined;
  return typeof value?.["documentId"] === "string"
    ? value["documentId"]
    : undefined;
};

export function MasterCardCreateDialog() {
  const t = useTranslations("OrderToShip");
  return (
    <WriteDialog
      triggerLabel={t("masterCardTrigger")}
      title={t("masterCardEditor")}
      description={t("masterCardEditorDetail")}
      closeLabel={t("closeMasterCard")}
      size="workspace"
      closeOnSaved={false}
      testId="master-card-create-dialog"
    >
      <MasterCardCreateWorkspace />
    </WriteDialog>
  );
}

function MasterCardCreateWorkspace() {
  const t = useTranslations("OrderToShip");
  const isMobile = useIsMobile();
  const surface = useWriteSurface();
  const [masterCardId, setMasterCardId] = useState<string>();
  const [photo, setPhoto] = useState<File | null>(null);
  const [drawing, setDrawing] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "failed">("idle");
  const attempted = useRef(false);
  const attached = useRef({ photo: false, drawing: false });
  const revisions = useQuery(
    listMasterCardRevisionsRef,
    masterCardId === undefined
      ? "skip"
      : { masterCardId, status: "DRAFT", maxPageSize: 1 },
  );
  const { upload, busy, progress } = useMasterCardFileUpload();
  const revision =
    revisions?.ok && revisions.value.ok ? revisions.value.items[0] : undefined;

  const uploadStaged = useCallback(async () => {
    if (revision === undefined || busy) return;
    setStatus("uploading");
    try {
      if (photo !== null && !attached.current.photo) {
        await upload({
          masterCardRevisionId: revision.masterCardRevisionId,
          fileKey: "PRODUCT-PHOTO-1",
          kind: "PHOTO",
          file: photo,
        });
        attached.current.photo = true;
      }
      if (drawing !== null && !attached.current.drawing) {
        await upload({
          masterCardRevisionId: revision.masterCardRevisionId,
          fileKey: "DIELINE-1",
          kind: "DIELINE",
          file: drawing,
        });
        attached.current.drawing = true;
      }
      surface?.complete();
    } catch {
      setStatus("failed");
    }
  }, [busy, drawing, photo, revision, surface, upload]);

  useEffect(() => {
    if (revision === undefined || attempted.current) return;
    attempted.current = true;
    void uploadStaged();
  }, [revision, uploadStaged]);

  const saved = (outcome: Record<string, unknown>) => {
    const id = documentId(outcome);
    if (id === undefined) return;
    if (photo === null && drawing === null) {
      surface?.complete();
      return;
    }
    setMasterCardId(id);
  };

  if (masterCardId !== undefined) {
    return (
      <div className="space-y-4 py-4">
        <Notice
          tone={status === "failed" ? "danger" : "pending"}
          title={
            status === "failed"
              ? t("fileUploadFailed")
              : t("draftSavedUploading")
          }
          {...(status === "uploading" && progress > 0
            ? {
                body: t("uploadProgress", {
                  progress: Math.round(progress),
                }),
              }
            : {})}
        />
        {status === "failed" ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy || revision === undefined}
            onClick={() => void uploadStaged()}
          >
            {t("retryFileUpload")}
          </Button>
        ) : null}
      </div>
    );
  }

  const assets = (
    <MasterCardAssetUploads photoChange={setPhoto} drawingChange={setDrawing} />
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <MasterCardDraftForm onSaved={saved} {...(isMobile ? { assets } : {})} />
      {isMobile ? null : (
        <aside
          className="sticky top-4 h-fit space-y-4 py-4"
          aria-label={t("masterCardAssets")}
        >
          <div>
            <h2 className="font-semibold text-text">{t("masterCardAssets")}</h2>
            <p className="mt-1 text-sm text-muted">
              {t("masterCardAssetsDetail")}
            </p>
          </div>
          {assets}
        </aside>
      )}
    </div>
  );
}

function MasterCardAssetUploads({
  photoChange,
  drawingChange,
}: {
  readonly photoChange: (file: File | null) => void;
  readonly drawingChange: (file: File | null) => void;
}) {
  const t = useTranslations("OrderToShip");
  return (
    <div className="space-y-4">
      <AssetUpload
        title={t("productImage")}
        kind="PHOTO"
        onChange={photoChange}
      />
      <AssetUpload
        title={t("drawingFile")}
        kind="DIELINE"
        onChange={drawingChange}
      />
    </div>
  );
}

function AssetUpload({
  title,
  kind,
  onChange,
}: {
  readonly title: string;
  readonly kind: "PHOTO" | "DIELINE";
  readonly onChange: (file: File | null) => void;
}) {
  const t = useTranslations("OrderToShip");
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <h3 className="font-semibold text-text">{title}</h3>
      <div className="mt-4">
        <PrivateFileUpload
          accept={acceptedTypesFor(kind)}
          maxSize={maximumInputBytesFor(kind)}
          disabled={false}
          showLimit={false}
          resetKey={0}
          labels={{
            drop: t("dropPrivateFile"),
            browse: t("choosePrivateFile"),
            limit: t("privateFileLimit", {
              size: `${Math.round(maximumInputBytesFor(kind) / 1024 / 1024)} MB`,
            }),
            remove: t("removeSelectedFile"),
            invalid: t("invalidPrivateFile"),
          }}
          onFileChange={onChange}
        />
      </div>
    </section>
  );
}
