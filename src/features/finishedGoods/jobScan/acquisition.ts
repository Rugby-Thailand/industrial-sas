import type { FunctionReturnType } from "convex/server";
import type { fgRefs } from "@/lib/convex/finishedGoodsApi";
import {
  MAX_JOB_TICKET_AI_DATA_URL,
  MAX_JOB_TICKET_UPLOAD_BYTES,
  type prepareJobTicketPhoto,
} from "./prepareJobTicketPhoto";
import {
  classifyTicketBarcode,
  mergeExtracted,
  newTicket,
  type TicketDraft,
} from "./ticketDraft";

type TicketImages = {
  detailImageUrl?: string;
  datesImageUrl?: string;
  deliveryImageUrl?: string;
};

export type AcquisitionPorts = {
  prepare: typeof prepareJobTicketPhoto;
  toDataUrl: (file: File) => Promise<string>;
  extract: (
    imageUrl: string,
    images?: TicketImages,
  ) => Promise<FunctionReturnType<typeof fgRefs.extractJobTicket>>;
  upload: (file: File) => Promise<{ url: string; assetId: string } | undefined>;
  createObjectURL: (file: File) => string;
  revokeObjectURL: (url: string) => void;
  addTicket: (ticket: TicketDraft) => void;
  updateTicket: (
    key: string,
    change: (ticket: TicketDraft) => TicketDraft,
  ) => void;
  onUploadError: (error: unknown) => void;
};

/** One workflow lifetime. Never owns save completion, navigation or other scopes' drafts. */
export class JobScanAcquisition {
  private readonly photos = new Map<
    string,
    { controller: AbortController; previewUrl: string }
  >();
  private disposed = false;

  /** Ports are read on each use, so a React owner can supply its latest callbacks. */
  constructor(private readonly currentPorts: () => AcquisitionPorts) {}

  private get ports() {
    return this.currentPorts();
  }

  async acquire(file: File): Promise<void> {
    if (this.disposed) return;
    const previewUrl = this.ports.createObjectURL(file);
    const ticket = {
      ...newTicket("AI"),
      status: "reading" as const,
      previewUrl,
    };
    const photo = { controller: new AbortController(), previewUrl };
    this.photos.set(ticket.key, photo);
    // release() and dispose() remove the entry, so membership is the only check.
    const current = () => this.photos.get(ticket.key) === photo;
    let reading: Promise<
      Awaited<ReturnType<AcquisitionPorts["extract"]>> | undefined
    > = Promise.resolve(undefined);
    let codes: readonly string[] = [];
    try {
      this.ports.addTicket(ticket);
      const image = await this.ports.prepare(file, {
        signal: photo.controller.signal,
        onAiReady: async (aiFile, evidence) => {
          if (!current()) return;
          codes = evidence?.codes ?? [];
          // Dispatch before optional WebP encoding, without awaiting the action.
          try {
            const imageUrl = await this.ports.toDataUrl(aiFile);
            if (!current() || imageUrl.length > MAX_JOB_TICKET_AI_DATA_URL)
              return;
            const images: TicketImages = {};
            let imageBytes = imageUrl.length;
            for (const [output, input] of [
              ["detailImageUrl", evidence?.detailImage],
              ["datesImageUrl", evidence?.datesImage],
              ["deliveryImageUrl", evidence?.deliveryImage],
            ] as const) {
              if (!input) continue;
              const url = await this.ports
                .toDataUrl(input)
                .catch(() => undefined);
              if (!current()) return;
              if (!url || imageBytes + url.length > MAX_JOB_TICKET_AI_DATA_URL)
                continue;
              images[output] = url;
              imageBytes += url.length;
            }
            reading = (
              Object.keys(images).length
                ? this.ports.extract(imageUrl, images)
                : this.ports.extract(imageUrl)
            ).catch(() => undefined);
          } catch {
            // AI input failure must not prevent storing the photo.
          }
        },
      });
      if (!current()) return;
      const [attachment, outcome] = await Promise.all([
        image.size <= MAX_JOB_TICKET_UPLOAD_BYTES
          ? this.ports.upload(image).catch((error: unknown) => {
              this.ports.onUploadError(error);
              return undefined;
            })
          : undefined,
        reading,
      ]);
      if (!current()) return;
      const imageUrl = attachment?.url;
      const result = outcome?.ok ? outcome.value : undefined;
      const barcodeFields = Object.fromEntries(
        codes.map((code) => [classifyTicketBarcode(code), code]),
      );
      this.ports.updateTicket(ticket.key, (row) => ({
        ...mergeExtracted(
          codes.length ? mergeExtracted(row, barcodeFields) : row,
          result?.ok ? result.fields : {},
        ),
        status: "ready",
        ...(imageUrl && attachment?.assetId
          ? { imageUrl, imageAssetId: attachment.assetId }
          : {}),
        ...(result?.ok
          ? {
              aiRaw: result.raw,
              ...(result.mock
                ? {}
                : { aiUsageOperationId: result.aiUsageOperationId }),
            }
          : {}),
        notice: !result?.ok
          ? result?.error.code === "RATE_LIMITED"
            ? "aiRateLimited"
            : "aiFailed"
          : !imageUrl
            ? "uploadFailed"
            : result.mock
              ? "aiMock"
              : "aiFilled",
      }));
    } catch {
      if (current())
        this.ports.updateTicket(ticket.key, (row) => ({
          ...row,
          status: "ready",
          notice: "photoProcessingFailed",
        }));
    }
  }

  /** Cancel local preparation and reject late transport results; server actions may still finish. */
  release(key: string): void {
    const photo = this.photos.get(key);
    if (!photo) return;
    this.photos.delete(key);
    photo.controller.abort();
    this.ports.revokeObjectURL(photo.previewUrl);
  }

  dispose(): void {
    this.disposed = true;
    for (const key of this.photos.keys()) this.release(key);
  }
}
