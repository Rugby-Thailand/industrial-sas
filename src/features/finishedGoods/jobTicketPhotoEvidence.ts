import { readBarcodes, type ReadResult } from "zxing-wasm/reader";
import {
  classifyTicketBarcode,
  JOB_TICKET_CODE_LIMITS,
} from "../../../convex/model/finishedGoods/jobScans";
import type { BarcodeCrop } from "./barcodeDecoder";
import type { BarcodeImageResult } from "./barcodeImage";

const MAX_SIDE = 1920;

type TicketBarcode = Pick<
  ReadResult,
  "text" | "format" | "isValid" | "orientation" | "position"
>;

function usableReads(reads: readonly TicketBarcode[]) {
  return reads.filter((read) => {
    const code = read.text.trim();
    return (
      read.isValid &&
      code.length > 0 &&
      code.length <= JOB_TICKET_CODE_LIMITS[classifyTicketBarcode(code)] &&
      !/^[Ii][Ss][Aa][Ss]:|[\u0000-\u001f]/.test(code)
    );
  });
}

function bounds(read: TicketBarcode) {
  const { topLeft, topRight, bottomLeft, bottomRight } = read.position;
  const points = [topLeft, topRight, bottomLeft, bottomRight];
  const left = Math.min(...points.map(({ x }) => x));
  const right = Math.max(...points.map(({ x }) => x));
  return {
    left,
    right,
    width: right - left,
    top: Math.min(...points.map(({ y }) => y)),
    bottom: Math.max(...points.map(({ y }) => y)),
  };
}

function upright(read: TicketBarcode) {
  return (
    Math.abs(read.orientation) <= 15 || Math.abs(read.orientation - 360) <= 15
  );
}

function detailCrop(
  anchor: TicketBarcode,
  product: TicketBarcode | undefined,
  height: number,
): BarcodeCrop | undefined {
  if (!upright(anchor)) return undefined;
  const header = bounds(anchor);
  const span = header.width * (anchor.format === "Code128" ? 1 : 2.8);
  if (!span) return undefined;
  const top = Math.max(0, Math.round(header.bottom - span * 0.08));
  const bottom = Math.min(
    height,
    Math.round(
      product && upright(product) && bounds(product).top > header.bottom
        ? bounds(product).bottom + span * 0.22
        : header.bottom + span * 2.42,
    ),
  );
  if (bottom - top < height * 0.23) return undefined;
  return { x: 0, y: top / height, width: 1, height: (bottom - top) / height };
}

export function ticketPhotoEvidence(
  reads: readonly TicketBarcode[],
  height: number,
): Pick<BarcodeImageResult, "codes" | "detailCrop" | "deliveryCrop"> {
  const valid = usableReads(reads);
  const jobs = valid.filter(
    (read) => classifyTicketBarcode(read.text) === "factoryOrder",
  );
  if (new Set(jobs.map((read) => read.text.trim())).size !== 1)
    return { codes: [] };

  const productReads = valid.filter(
    (read) =>
      read.format === "Code128" &&
      classifyTicketBarcode(read.text) === "productBarcodeText" &&
      !/^F\d+-L\d+-\d+(?:-[A-Z0-9]+)*$/i.test(read.text.trim()),
  );
  if (new Set(productReads.map((read) => read.text.trim())).size > 1) {
    return { codes: [] };
  }

  const anchor = jobs.find((read) => read.format === "Code128") ?? jobs[0]!;
  const header = bounds(anchor);
  const span = header.width * (anchor.format === "QRCode" ? 2.8 : 1);
  const product = productReads.find((read) => {
    if (!upright(anchor) || !upright(read) || !span) return false;
    const label = bounds(read);
    const gap = label.top - header.bottom;
    // Allow the QR to sit to the left of the product line. A distant barcode
    // elsewhere in the photo cannot verify this ticket's product.
    const horizontalGap = Math.max(
      header.left - label.right,
      label.left - header.right,
    );
    return (
      gap > 0 &&
      gap <= span * 3.2 &&
      horizontalGap <= span * (anchor.format === "QRCode" ? 1 : 0.45)
    );
  });
  const crop = detailCrop(anchor, product, height);
  const deliveryTop = Math.max(0, Math.round(header.bottom + span * 0.046));
  const deliveryBottom = Math.min(
    height,
    Math.round(header.bottom + span * 0.54),
  );
  const deliveryCrop =
    !product &&
    anchor.format === "QRCode" &&
    upright(anchor) &&
    deliveryBottom - deliveryTop >= 20
      ? {
          x: 0.15,
          y: deliveryTop / height,
          width: 0.44,
          height: (deliveryBottom - deliveryTop) / height,
        }
      : undefined;
  return {
    codes: [anchor.text.trim(), ...(product ? [product.text.trim()] : [])],
    ...(crop ? { detailCrop: crop } : {}),
    ...(deliveryCrop ? { deliveryCrop } : {}),
  };
}

export async function inspectJobTicketPhoto(
  image: ImageBitmap,
): Promise<BarcodeImageResult> {
  const started = performance.now();
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Missing barcode canvas");
  context.drawImage(image, 0, 0, width, height);
  try {
    const rows = await readBarcodes(context.getImageData(0, 0, width, height), {
      formats: ["Code128", "QRCode"],
      tryHarder: true,
      maxNumberOfSymbols: 8,
    });
    return {
      ...ticketPhotoEvidence(rows, height),
      reviewRequired: false,
      attempts: 1,
      elapsedMs: performance.now() - started,
    };
  } finally {
    canvas.width = canvas.height = 1;
  }
}
