import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  prepareJobTicketPhoto,
  type JobTicketPhotoEvidence,
} from "./prepareJobTicketPhoto";
import { readBarcodeImage } from "../barcodeImage";

vi.mock("../barcodeImage", () => ({
  readBarcodeImage: vi.fn(),
}));
import { prepareLocationImage } from "./prepareLocationImage";

const jpeg = new Blob([new Uint8Array(100)], { type: "image/jpeg" });
const aiJpeg = new Blob([new Uint8Array(40)], { type: "image/jpeg" });
const webp = new Blob([new Uint8Array(60)], { type: "image/webp" });
const file = () => new File(["photo"], "ticket.png", { type: "image/png" });
const close = vi.fn();
const drawImage = vi.fn();
const onAiReady = vi.fn(
  async (_image: File, _evidence?: JobTicketPhotoEvidence) => {},
);
let bitmap: { width: number; height: number; close: typeof close };
let encodings: { canvas: HTMLCanvasElement; type: string | undefined }[];

beforeEach(() => {
  close.mockReset();
  drawImage.mockReset();
  onAiReady.mockClear();
  vi.mocked(readBarcodeImage)
    .mockReset()
    .mockResolvedValue({
      codes: ["FO12345", "BOX-A"],
      reviewRequired: false,
      attempts: 1,
      elapsedMs: 60,
    });
  encodings = [];
  bitmap = { width: 4032, height: 3024, close };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
    fillRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type,
  ) {
    encodings.push({ canvas: this, type });
    callback(type === "image/jpeg" ? jpeg : webp);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function prepare(signal = new AbortController().signal) {
  return prepareJobTicketPhoto(file(), { signal, onAiReady });
}

it("dispatches a 1280 px JPEG and a barcode-anchored close-up before encoding the 2000 px upload", async () => {
  vi.mocked(readBarcodeImage).mockResolvedValue({
    codes: ["FO12345", "BOX-A"],
    detailCrop: { x: 0, y: 0.2, width: 1, height: 0.5 },
    reviewRequired: false,
    attempts: 1,
    elapsedMs: 60,
  });
  let finishWebp!: BlobCallback;
  const sizes: [string | undefined, number, number][] = [];
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type,
    quality,
  ) {
    encodings.push({ canvas: this, type });
    sizes.push([type, this.width, this.height]);
    if (type === "image/jpeg") {
      expect(quality).toBe(0.85);
      if (this.width === 1280 || this.width === 1600) callback(aiJpeg);
      else {
        expect(onAiReady).toHaveBeenCalledOnce();
        callback(jpeg);
      }
    } else {
      expect(onAiReady).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
      finishWebp = callback;
    }
  });
  const preparing = prepare();
  await waitFor(() => expect(finishWebp).toBeTypeOf("function"));
  const ai = onAiReady.mock.calls[0]![0];
  expect(ai.name).toBe("ticket.jpg");
  expect(ai.type).toBe("image/jpeg");
  expect(ai.size).toBe(40);
  expect(onAiReady.mock.calls[0]?.[1]).toMatchObject({
    codes: ["FO12345", "BOX-A"],
    detailImage: { type: "image/jpeg" },
  });
  expect(sizes).toEqual([
    ["image/jpeg", 1280, 960],
    ["image/jpeg", 1600, 600],
    ["image/jpeg", 2000, 1500],
    ["image/webp", 2000, 1500],
  ]);
  expect(drawImage).toHaveBeenNthCalledWith(1, bitmap, 0, 0, 1280, 960);
  expect(drawImage).toHaveBeenNthCalledWith(2, bitmap, 0, 0, 2000, 1500);
  expect(createImageBitmap).toHaveBeenCalledOnce();
  finishWebp(webp);
  const stored = await preparing;
  expect(stored.name).toBe("ticket.webp");
  expect(stored.type).toBe("image/webp");
  expect(stored.size).toBe(60);
  expect(encodings.every(({ canvas }) => !canvas.width && !canvas.height)).toBe(
    true,
  );
});

it("does not enlarge small photos and preserves portrait geometry", async () => {
  bitmap.width = 300;
  bitmap.height = 400;
  await prepare();
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 300, 400);
});

it.each([
  ["larger", new Blob([new Uint8Array(101)], { type: "image/webp" })],
  ["equal", new Blob([new Uint8Array(100)], { type: "image/webp" })],
  ["marginal saving", new Blob([new Uint8Array(86)], { type: "image/webp" })],
  ["unsupported MIME", new Blob(["png fallback"], { type: "image/png" })],
  ["null blob", null],
] as const)(
  "keeps the original JPEG on a %s WebP result",
  async (_label, blob) => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(function (
      this: HTMLCanvasElement,
      callback,
      type,
    ) {
      callback(
        type === "image/jpeg" ? (this.width === 2300 ? aiJpeg : jpeg) : blob,
      );
    });
    const stored = await prepare();
    expect(stored.size).toBe(jpeg.size);
    expect(onAiReady.mock.calls[0]![0].size).toBe(aiJpeg.size);
    expect(stored.type).toBe("image/jpeg");
  },
);

it("keeps JPEG when the optional encoder throws", async () => {
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(
    (callback, type) => {
      if (type === "image/webp") throw new Error("Encoder unavailable");
      callback(jpeg);
    },
  );
  expect((await prepare()).type).toBe("image/jpeg");
});

it("stores the AI JPEG when the larger upload encode fails after dispatch", async () => {
  let jpegCalls = 0;
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(
    (callback, type) => {
      if (type === "image/jpeg" && ++jpegCalls === 2) return callback(null);
      callback(type === "image/jpeg" ? aiJpeg : webp);
    },
  );
  const stored = await prepare();
  expect(onAiReady).toHaveBeenCalledOnce();
  expect(stored).toBe(onAiReady.mock.calls[0]![0]);
});

it("crops location photos before limiting the AI JPEG to 1280 px", async () => {
  bitmap.width = 4000;
  bitmap.height = 3000;
  const crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.25 };
  expect(await prepareLocationImage(file(), { crop })).toMatch(
    /^data:image\/jpeg;base64,/,
  );
  expect(drawImage).toHaveBeenCalledExactlyOnceWith(
    bitmap,
    1000,
    750,
    2000,
    750,
    0,
    0,
    1280,
    480,
  );
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledExactlyOnceWith(
    expect.any(Function),
    "image/jpeg",
    0.85,
  );
});

it.each([null, new Blob(["png"], { type: "image/png" })])(
  "rejects failed JPEG encoding instead of renaming or uploading invalid bytes (%s)",
  async (blob) => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(
      (callback) => callback(blob),
    );
    await expect(prepare()).rejects.toThrow("imageUnreadable");
    expect(onAiReady).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(encodings).toHaveLength(0);
  },
);

it("rejects a missing drawing context and still releases the full-size decode", async () => {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  await expect(prepare()).rejects.toThrow("imageUnreadable");
  expect(onAiReady).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
});

it("rejects a failed draw rather than storing an empty canvas", async () => {
  drawImage.mockImplementation(() => {
    throw new Error("Cannot draw");
  });
  await expect(prepare()).rejects.toThrow("Cannot draw");
  expect(close).toHaveBeenCalledOnce();
  expect(onAiReady).not.toHaveBeenCalled();
});

it.each([
  [0, 1],
  [1, 0],
])("rejects invalid pixel dimensions (%s × %s)", async (width, height) => {
  bitmap.width = width;
  bitmap.height = height;
  await expect(prepare()).rejects.toThrow("imageSize");
  expect(drawImage).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  expect(onAiReady).not.toHaveBeenCalled();
});

it("continues to downscale valid 48 MP gallery photos", async () => {
  bitmap.width = 8064;
  bitmap.height = 6048;
  await prepare();
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2000, 1500);
  expect(onAiReady).toHaveBeenCalledOnce();
});

it("rejects undecodable photos without dispatching AI", async () => {
  vi.mocked(createImageBitmap).mockRejectedValue(
    new Error("Unsupported photo"),
  );
  await expect(prepare()).rejects.toThrow("Unsupported photo");
  expect(onAiReady).not.toHaveBeenCalled();
});

it("does no work for a photo already discarded", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(prepare(controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(createImageBitmap).not.toHaveBeenCalled();
});

it("dispatches AI for the whole batch without waiting for encoder slots and cancels queued uploads", async () => {
  const pending: BlobCallback[] = [];
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type,
  ) {
    encodings.push({ canvas: this, type });
    if (type === "image/jpeg") callback(jpeg);
    else pending.push(callback);
  });
  const controllers = Array.from({ length: 20 }, () => new AbortController());
  const tasks = controllers.map((controller) => prepare(controller.signal));
  // Attach rejection handlers before aborting to verify cancellation, not a leak.
  const settled = Promise.allSettled(tasks);
  await waitFor(() => expect(onAiReady).toHaveBeenCalledTimes(20));
  expect(pending).toHaveLength(2);
  controllers.slice(2).forEach((controller) => controller.abort());
  pending.forEach((callback) => callback(webp));
  const outcomes = await settled;
  expect(
    outcomes.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(2);
  expect(
    outcomes.filter((result) => result.status === "rejected"),
  ).toHaveLength(18);
  expect(pending).toHaveLength(2);
  expect(encodings.every(({ canvas }) => !canvas.width && !canvas.height)).toBe(
    true,
  );
});

it("does not return an upload after cancellation during encoding", async () => {
  let finishWebp!: BlobCallback;
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(
    (callback, type) => {
      if (type === "image/jpeg") callback(jpeg);
      else finishWebp = callback;
    },
  );
  const controller = new AbortController();
  const preparing = prepare(controller.signal);
  const rejected = expect(preparing).rejects.toMatchObject({
    name: "AbortError",
  });
  await waitFor(() => expect(finishWebp).toBeTypeOf("function"));
  controller.abort();
  finishWebp(webp);
  await rejected;
});

it("keeps a larger whole-ticket AI image when barcode inspection is unavailable", async () => {
  vi.mocked(readBarcodeImage).mockRejectedValue(new Error("Unavailable"));
  await prepare();
  expect(drawImage).toHaveBeenNthCalledWith(1, bitmap, 0, 0, 2300, 1725);
  expect(drawImage).toHaveBeenNthCalledWith(2, bitmap, 0, 0, 2000, 1500);
  expect(onAiReady.mock.calls[0]?.[1]).toMatchObject({
    codes: [],
    datesImage: { type: "image/jpeg" },
  });
});
