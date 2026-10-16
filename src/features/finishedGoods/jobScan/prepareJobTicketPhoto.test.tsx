import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareJobTicketPhoto } from "./prepareJobTicketPhoto";

const jpeg = new Blob([new Uint8Array(100)], { type: "image/jpeg" });
const webp = new Blob([new Uint8Array(60)], { type: "image/webp" });
const file = () => new File(["photo"], "ticket.png", { type: "image/png" });
const close = vi.fn();
const drawImage = vi.fn();
const onAiReady = vi.fn(async (_image: File) => {});
let bitmap: { width: number; height: number; close: typeof close };
let encodings: { canvas: HTMLCanvasElement; type: string | undefined }[];

beforeEach(() => {
  close.mockReset();
  drawImage.mockReset();
  onAiReady.mockClear();
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

it("dispatches the unchanged JPEG before WebP, decodes once, and stores only the smaller file", async () => {
  let finishWebp!: BlobCallback;
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type,
    quality,
  ) {
    encodings.push({ canvas: this, type });
    if (type === "image/jpeg") {
      expect(quality).toBe(0.85);
      callback(jpeg);
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
  expect(ai.size).toBe(100);
  expect(drawImage).toHaveBeenCalledExactlyOnceWith(bitmap, 0, 0, 2000, 1500);
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
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(
      (callback, type) => callback(type === "image/jpeg" ? jpeg : blob),
    );
    const stored = await prepare();
    expect(stored).toBe(onAiReady.mock.calls[0]![0]);
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
