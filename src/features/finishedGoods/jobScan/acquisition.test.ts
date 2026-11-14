import { expect, it, vi } from "vitest";
import { JobScanAcquisition, type AcquisitionPorts } from "./acquisition";
import type { TicketDraft } from "./ticketDraft";

type Extraction = Awaited<ReturnType<AcquisitionPorts["extract"]>>;
type Attachment = Awaited<ReturnType<AcquisitionPorts["upload"]>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const file = new File(["photo"], "ticket.jpg", { type: "image/jpeg" });
const attachment = {
  url: "https://example.com/ticket.webp",
  assetId: "asset-a",
};
const extracted: Extraction = {
  ok: true,
  requestId: "extract-a",
  value: {
    ok: true,
    mock: false,
    fields: { factoryOrder: "FO12345", productBarcodeText: "PRODUCT-A" },
    raw: "{}",
    aiUsageOperationId: "usage-a",
  },
};

function harness() {
  const tickets = new Map<string, TicketDraft>();
  const extractStarted = deferred<void>();
  const uploadStarted = deferred<void>();
  const ports = {
    prepare: vi.fn<AcquisitionPorts["prepare"]>(async (image, options) => {
      await options.onAiReady(image);
      return image;
    }),
    toDataUrl: vi
      .fn<AcquisitionPorts["toDataUrl"]>()
      .mockResolvedValue("data:image/jpeg;base64,AA"),
    extract: vi.fn<AcquisitionPorts["extract"]>(async () => {
      extractStarted.resolve();
      return extracted;
    }),
    upload: vi.fn<AcquisitionPorts["upload"]>(async () => {
      uploadStarted.resolve();
      return attachment;
    }),
    createObjectURL: vi.fn<AcquisitionPorts["createObjectURL"]>(
      () => `blob:${crypto.randomUUID()}`,
    ),
    revokeObjectURL: vi.fn<AcquisitionPorts["revokeObjectURL"]>(),
    addTicket: vi.fn<AcquisitionPorts["addTicket"]>((ticket) => {
      tickets.set(ticket.key, ticket);
    }),
    updateTicket: vi.fn<AcquisitionPorts["updateTicket"]>((key, change) => {
      const ticket = tickets.get(key);
      if (ticket) tickets.set(key, change(ticket));
    }),
    onUploadError: vi.fn<AcquisitionPorts["onUploadError"]>(),
  };
  return {
    controller: new JobScanAcquisition(ports),
    ports,
    tickets,
    extractStarted,
    uploadStarted,
    first: () => [...tickets.values()][0]!,
  };
}

function pendingTransports(h: ReturnType<typeof harness>) {
  const extraction = deferred<Extraction>();
  const upload = deferred<Attachment>();
  h.ports.extract.mockImplementation(() => {
    h.extractStarted.resolve();
    return extraction.promise;
  });
  h.ports.upload.mockImplementation(() => {
    h.uploadStarted.resolve();
    return upload.promise;
  });
  return { extraction, upload };
}

it("removing a ticket during preparation aborts local work and ignores late preparation", async () => {
  const h = harness();
  const prepared = deferred<File>();
  h.ports.prepare.mockImplementation(async (_file, options) => {
    const image = await prepared.promise;
    // Deliberately ignore the signal, as an already-running browser task can.
    await options.onAiReady(image);
    return image;
  });
  const work = h.controller.acquire(file);
  const ticket = h.first();
  h.controller.release(ticket.key);
  h.tickets.delete(ticket.key);
  expect(h.ports.prepare.mock.calls[0]![1].signal.aborted).toBe(true);
  prepared.resolve(file);
  await work;
  expect(h.ports.toDataUrl).not.toHaveBeenCalled();
  expect(h.ports.extract).not.toHaveBeenCalled();
  expect(h.ports.upload).not.toHaveBeenCalled();
  expect(h.ports.updateTicket).not.toHaveBeenCalled();
  h.controller.dispose();
  expect(h.ports.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
    ticket.previewUrl,
  );
});

it("keeps AI fields and typed edits when extraction succeeds but upload fails", async () => {
  const h = harness();
  const pending = pendingTransports(h);
  const work = h.controller.acquire(file);
  await h.uploadStarted.promise;
  const ticket = h.first();
  h.tickets.set(ticket.key, {
    ...ticket,
    values: { factoryOrder: "FO-TYPED" },
  });
  pending.extraction.resolve(extracted);
  const error = new Error("upload failed");
  pending.upload.reject(error);
  await work;
  expect(h.first()).toMatchObject({
    status: "ready",
    values: { factoryOrder: "FO-TYPED", productBarcodeText: "PRODUCT-A" },
    aiFields: ["productBarcodeText"],
    aiRaw: "{}",
    aiUsageOperationId: "usage-a",
    notice: "uploadFailed",
  });
  expect(h.first().imageAssetId).toBeUndefined();
  expect(h.ports.onUploadError).toHaveBeenCalledExactlyOnceWith(error);
  h.controller.dispose();
});

it.each(["rejected", "unreadable", "rateLimited"] as const)(
  "keeps the uploaded asset when AI fails: %s",
  async (failure) => {
    const h = harness();
    const pending = pendingTransports(h);
    const work = h.controller.acquire(file);
    await h.uploadStarted.promise;
    pending.upload.resolve(attachment);
    if (failure === "rejected")
      pending.extraction.reject(new Error("AI unavailable"));
    else
      pending.extraction.resolve({
        ok: true,
        requestId: "extract-a",
        value:
          failure === "rateLimited"
            ? { ok: false, error: { code: "RATE_LIMITED" }, retryAfterMs: 1000 }
            : { ok: false, error: { code: "AI_UNREADABLE" } },
      });
    await work;
    expect(h.first()).toMatchObject({
      status: "ready",
      imageUrl: attachment.url,
      imageAssetId: attachment.assetId,
      values: {},
      notice: failure === "rateLimited" ? "aiRateLimited" : "aiFailed",
    });
    h.controller.dispose();
  },
);

it("accepts a retry after preparation failure without losing the editable failed ticket", async () => {
  const h = harness();
  const failed = deferred<File>();
  h.ports.prepare.mockImplementationOnce(() => failed.promise);
  const firstWork = h.controller.acquire(file);
  failed.reject(new Error("decode failed"));
  await firstWork;
  expect(h.first()).toMatchObject({
    status: "ready",
    notice: "photoProcessingFailed",
  });
  await h.controller.acquire(file);
  expect([...h.tickets.values()].map((ticket) => ticket.notice)).toEqual([
    "photoProcessingFailed",
    "aiFilled",
  ]);
  expect(h.ports.extract).toHaveBeenCalledOnce();
  expect(h.ports.upload).toHaveBeenCalledOnce();
  h.controller.dispose();
  expect(h.ports.revokeObjectURL).toHaveBeenCalledTimes(2);
});

it("rejects old scope results while a new warehouse controller completes independently", async () => {
  const old = harness();
  const pending = pendingTransports(old);
  const oldWork = old.controller.acquire(file);
  await old.uploadStarted.promise;
  old.controller.dispose();
  const next = harness();
  await next.controller.acquire(file);
  expect(next.first()).toMatchObject({ status: "ready", notice: "aiFilled" });
  pending.extraction.resolve(extracted);
  pending.upload.resolve(attachment);
  await oldWork;
  await old.controller.acquire(file);
  expect(old.ports.updateTicket).not.toHaveBeenCalled();
  expect(old.ports.addTicket).toHaveBeenCalledOnce();
  expect(old.ports.prepare.mock.calls[0]![1].signal.aborted).toBe(true);
  expect(old.ports.revokeObjectURL).toHaveBeenCalledOnce();
  expect(next.ports.updateTicket).toHaveBeenCalledOnce();
  next.controller.dispose();
});

it.each(["preparation", "dataUrl", "transport"] as const)(
  "dispose mid-flight during %s rejects every late result and new intake",
  async (phase) => {
    const h = harness();
    const prepared = deferred<File>();
    const dataUrl = deferred<string>();
    const pending = pendingTransports(h);
    if (phase === "preparation")
      h.ports.prepare.mockImplementation(() => prepared.promise);
    if (phase === "dataUrl") h.ports.toDataUrl.mockReturnValue(dataUrl.promise);
    const work = h.controller.acquire(file);
    if (phase === "transport") await h.uploadStarted.promise;
    h.controller.dispose();
    prepared.resolve(file);
    dataUrl.resolve("data:image/jpeg;base64,AA");
    pending.extraction.resolve(extracted);
    pending.upload.resolve(attachment);
    await work;
    await h.controller.acquire(file);
    expect(h.ports.updateTicket).not.toHaveBeenCalled();
    expect(h.ports.addTicket).toHaveBeenCalledOnce();
    expect(h.ports.revokeObjectURL).toHaveBeenCalledOnce();
    expect(h.ports.prepare.mock.calls[0]![1].signal.aborted).toBe(true);
    if (phase !== "transport") {
      expect(h.ports.extract).not.toHaveBeenCalled();
      expect(h.ports.upload).not.toHaveBeenCalled();
    }
  },
);

it("revokes every preview exactly once across removal, failure, completion and repeated disposal", async () => {
  const h = harness();
  await h.controller.acquire(file);
  const removed = h.first();
  h.controller.release(removed.key);
  h.controller.release(removed.key);
  h.ports.prepare.mockRejectedValueOnce(new Error("bad image"));
  await h.controller.acquire(file);
  await h.controller.acquire(file);
  // Successful upload does not release a preview still displayed by the draft.
  expect(h.ports.revokeObjectURL).toHaveBeenCalledTimes(1);
  h.controller.dispose();
  h.controller.dispose();
  for (const ticket of h.tickets.values()) h.controller.release(ticket.key);
  const created = h.ports.createObjectURL.mock.results.map(
    (result) => result.value,
  );
  const revoked = h.ports.revokeObjectURL.mock.calls.map(([url]) => url);
  expect(created).toHaveLength(3);
  expect(new Set(created).size).toBe(3);
  expect(revoked.sort()).toEqual(created.sort());
});

it("runs tickets in parallel and starts upload while each AI response is still pending", async () => {
  const h = harness();
  const firstAI = deferred<Extraction>();
  const secondAI = deferred<Extraction>();
  const bothUploads = deferred<void>();
  h.ports.extract
    .mockReturnValueOnce(firstAI.promise)
    .mockReturnValueOnce(secondAI.promise);
  h.ports.upload.mockImplementation(async () => {
    if (h.ports.upload.mock.calls.length === 2) bothUploads.resolve();
    return attachment;
  });
  const firstWork = h.controller.acquire(file);
  const secondWork = h.controller.acquire(file);
  await bothUploads.promise;
  expect(h.ports.extract).toHaveBeenCalledTimes(2);
  expect(h.ports.updateTicket).not.toHaveBeenCalled();
  secondAI.resolve(extracted);
  await secondWork;
  expect([...h.tickets.values()].map((ticket) => ticket.status)).toEqual([
    "reading",
    "ready",
  ]);
  firstAI.resolve(extracted);
  await firstWork;
  h.controller.dispose();
});
