import { resolve } from "node:path";
import { expect, test } from "../support/fixtures";

const url = `http://127.0.0.1:${process.env.BARCODE_PORT ?? 3199}`;
const modules = {
  prepare: `/@fs${resolve("src/features/finishedGoods/jobScan/prepareJobTicketPhoto.ts")}`,
  baseline: `/@fs${resolve("src/features/finishedGoods/jobScan/resizeImage.ts")}`,
  decoder: `/@fs${resolve("src/features/finishedGoods/barcodeDecoder.ts")}`,
};

test("real encoders preserve the AI bytes, dispatch before WebP, and keep barcode readability", async ({
  page,
}) => {
  await page.goto(url);
  const result = await page.evaluate(async (modules) => {
    const { prepareJobTicketPhoto } = await import(modules.prepare);
    const { resizeImage } = await import(modules.baseline);
    const { decodeBarcodeImage } = await import(modules.decoder);
    const source = new File(
      [await fetch("/location-3-11.png").then((response) => response.blob())],
      "label.png",
      { type: "image/png" },
    );
    const baseline: File = await resizeImage(source);
    const baselineBytes = new Uint8Array(await baseline.arrayBuffer());
    let identicalAI = false;
    let aiDispatched = false;
    let webpAfterAI = false;
    let selectedJPEG = false;
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type === "image/webp") webpAfterAI = aiDispatched;
      original.call(this, callback, type, quality);
    };
    let stored: File;
    try {
      stored = await prepareJobTicketPhoto(source, {
        signal: new AbortController().signal,
        onAiReady: async (file: File) => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          identicalAI =
            bytes.length === baselineBytes.length &&
            bytes.every((value, index) => value === baselineBytes[index]);
          selectedJPEG =
            file.type === "image/jpeg" && file.name.endsWith(".jpg");
          aiDispatched = true;
        },
      });
    } finally {
      HTMLCanvasElement.prototype.toBlob = original;
    }
    const before = await decodeBarcodeImage(baseline);
    const after = await decodeBarcodeImage(stored);
    const image = await createImageBitmap(stored);
    const dimensions = { width: image.width, height: image.height };
    image.close();
    return {
      identicalAI,
      webpAfterAI,
      selectedJPEG,
      type: stored.type,
      name: stored.name,
      bytes: stored.size,
      baselineBytes: baseline.size,
      before,
      after,
      dimensions,
    };
  }, modules);
  expect(result.identicalAI).toBe(true);
  expect(result.webpAfterAI).toBe(true);
  expect(result.selectedJPEG).toBe(true);
  expect(result.bytes).toBeLessThanOrEqual(result.baselineBytes);
  expect(result.type).toBe("image/webp");
  expect(result.name).toBe("label.webp");
  expect(result.before).toContain("F1-L3-11");
  expect(result.after).toEqual(result.before);
  expect(
    Math.max(result.dimensions.width, result.dimensions.height),
  ).toBeLessThanOrEqual(2000);
});

test("a real canvas preserves transparency appearance and rejects corrupt images", async ({
  page,
}) => {
  await page.goto(url);
  const result = await page.evaluate(async (modules) => {
    const { prepareJobTicketPhoto } = await import(modules.prepare);
    const { resizeImage } = await import(modules.baseline);
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 400;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.font = "24px sans-serif";
    context.fillText("FO69070073", 25, 100);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!)),
    );
    const source = new File([blob], "transparent.png", { type: "image/png" });
    const baseline = await resizeImage(source);
    const stored = await prepareJobTicketPhoto(source, {
      signal: new AbortController().signal,
      onAiReady: async () => {},
    });
    const pixels = async (file: File) => {
      const bitmap = await createImageBitmap(file);
      context.clearRect(0, 0, 300, 400);
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const before = await pixels(baseline);
    const after = await pixels(stored);
    let rejected = false;
    let dispatched = false;
    try {
      await prepareJobTicketPhoto(
        new File(["corrupt"], "bad.jpg", { type: "image/jpeg" }),
        {
          signal: new AbortController().signal,
          onAiReady: async () => {
            dispatched = true;
          },
        },
      );
    } catch {
      rejected = true;
    }
    return { before, after, rejected, dispatched };
  }, modules);
  expect(result.before).toEqual([0, 0, 0, 255]);
  expect(result.after).toEqual(result.before);
  expect(result.rejected).toBe(true);
  expect(result.dispatched).toBe(false);
});

test("EXIF orientation stays identical to the existing JPEG pipeline", async ({
  page,
}) => {
  await page.goto(url);
  const result = await page.evaluate(async (modules) => {
    const { prepareJobTicketPhoto } = await import(modules.prepare);
    const { resizeImage } = await import(modules.baseline);
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 400;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, 600, 400);
    context.fillStyle = "black";
    context.fillRect(0, 0, 100, 400);
    const jpeg = new Uint8Array(
      await (
        await new Promise<Blob>((resolve) =>
          canvas.toBlob((blob) => resolve(blob!), "image/jpeg", 0.9),
        )
      ).arrayBuffer(),
    );
    // EXIF little-endian TIFF, orientation 6: rotate 90 degrees clockwise.
    const exif = new Uint8Array([
      0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0,
      8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const source = new File(
      [jpeg.slice(0, 2), exif, jpeg.slice(2)],
      "rotated.jpg",
      { type: "image/jpeg" },
    );
    const baseline = await resizeImage(source);
    let ai: File | undefined;
    const stored = await prepareJobTicketPhoto(source, {
      signal: new AbortController().signal,
      onAiReady: async (file: File) => {
        ai = file;
      },
    });
    const a = new Uint8Array(await baseline.arrayBuffer());
    const b = new Uint8Array(await ai!.arrayBuffer());
    const bitmap = await createImageBitmap(stored);
    const size = [bitmap.width, bitmap.height];
    bitmap.close();
    return {
      identical:
        a.length === b.length && a.every((value, index) => value === b[index]),
      size,
    };
  }, modules);
  expect(result.identical).toBe(true);
  expect(result.size).toEqual([400, 600]);
});
