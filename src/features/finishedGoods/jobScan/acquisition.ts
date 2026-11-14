import type { FunctionReturnType } from "convex/server";
import type { fgRefs } from "@/lib/convex/finishedGoodsApi";
import {
  MAX_JOB_TICKET_AI_DATA_URL,
  MAX_JOB_TICKET_UPLOAD_BYTES,
  type prepareJobTicketPhoto,
} from "./prepareJobTicketPhoto";
import { mergeExtracted, newTicket, type TicketDraft } from "./ticketDraft";

export type AcquisitionPorts = {
  prepare: typeof prepareJobTicketPhoto;
  toDataUrl: (file: File) => Promise<string>;
  extract: (
    imageUrl: string,
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

  constructor(private readonly ports: AcquisitionPorts) {}

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
    const current = () =>
      !this.disposed &&
      this.photos.get(ticket.key) === photo &&
      !photo.controller.signal.aborted;
    let reading: Promise<
      Awaited<ReturnType<AcquisitionPorts["extract"]>> | undefined
    > = Promise.resolve(undefined);
    try {
      this.ports.addTicket(ticket);
      const image = await this.ports.prepare(file, {
        signal: photo.controller.signal,
        onAiReady: async (aiFile) => {
          if (!current()) return;
          // Dispatch before optional WebP encoding, without awaiting the action.
          try {
            const imageUrl = await this.ports.toDataUrl(aiFile);
            if (current() && imageUrl.length <= MAX_JOB_TICKET_AI_DATA_URL)
              reading = this.ports.extract(imageUrl).catch(() => undefined);
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
      this.ports.updateTicket(ticket.key, (row) => ({
        ...(result?.ok ? mergeExtracted(row, result.fields) : row),
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
