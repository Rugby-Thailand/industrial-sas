"use client";

import { useMutation } from "convex/react";
import { useCallback, useState } from "react";

import {
  attachMasterCardFileRef,
  authorizeMasterCardFileUploadRef,
  type MasterCardFileKind,
} from "@/lib/convex/orderToShipApi";
import { newRequestId } from "@/lib/convex/writeState";
import { optimizeUpload } from "@/lib/files/optimizeUpload";
import { useUploadThing } from "@/lib/uploadthing/client";

export interface MasterCardFileUploadRequest {
  readonly masterCardRevisionId: string;
  readonly fileKey: string;
  readonly kind: MasterCardFileKind;
  readonly file: File;
}

export interface MasterCardFileUploadResult {
  readonly optimized: boolean;
  readonly originalBytes: number;
  readonly uploadedBytes: number;
}

export function useMasterCardFileUpload() {
  const authorize = useMutation(authorizeMasterCardFileUploadRef);
  const attach = useMutation(attachMasterCardFileRef);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const { startUpload, isUploading } = useUploadThing("masterCardFile", {
    onUploadProgress: setProgress,
  });

  const upload = useCallback(
    async (
      request: MasterCardFileUploadRequest,
    ): Promise<MasterCardFileUploadResult> => {
      if (busy || isUploading) throw new Error("UPLOAD_BUSY");
      setBusy(true);
      setProgress(0);
      try {
        const prepared = await optimizeUpload(request.file, request.kind);
        const authorization = await authorize({
          masterCardRevisionId: request.masterCardRevisionId,
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
          masterCardRevisionId: request.masterCardRevisionId,
          fileKey: request.fileKey.trim(),
          fileName: prepared.file.name,
          kind: request.kind,
          contentType: verified.contentType,
          byteSize: verified.byteSize,
          contentDigest: verified.contentDigest,
          uploadThingKey: verified.providerKey,
          uploadGrantId: authorization.value.uploadGrantId,
        });
        if (!attached.ok || !attached.value.written) {
          throw new Error("ATTACH_FAILED");
        }
        return {
          optimized: prepared.optimized,
          originalBytes: prepared.originalBytes,
          uploadedBytes: verified.byteSize,
        };
      } finally {
        setBusy(false);
      }
    },
    [attach, authorize, busy, isUploading, startUpload],
  );

  return { upload, busy: busy || isUploading, progress } as const;
}
