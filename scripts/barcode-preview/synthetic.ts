import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";
import { readBarcodeImage } from "@/features/finishedGoods/barcodeImage";
import type { BarcodeImageTarget } from "@/features/finishedGoods/barcodeImage";

export async function barcodeFixture(
  codes = ["DEMO-PRODUCT"],
  qr = false,
  angle = 0,
): Promise<File> {
  await prepareZXingModule({
    overrides: { locateFile: () => "/fixture-writer.wasm" },
    fireImmediately: true,
  });
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1600;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1200, 1600);
  ctx.translate(600, 800);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.translate(-600, -800);
  ctx.fillStyle = "black";
  ctx.font = "32px sans-serif";
  ctx.fillText("Synthetic warehouse label", 100, 130);
  for (const [i, code] of codes.entries()) {
    const encoded = await writeBarcode(code, {
      format: qr ? "QRCode" : "Code128",
      scale: 3,
    });
    if (encoded.error || !encoded.image)
      throw new Error(encoded.error || "Fixture encoding failed");
    const bitmap = await createImageBitmap(encoded.image);
    const y = 500 + i * 400;
    ctx.drawImage(bitmap, 100, y, qr ? 240 : 1000, qr ? 240 : 100);
    bitmap.close();
    // Printed text intentionally differs from the encoded value, proving pixels are the source.
    ctx.fillText("PRINTED-TEXT-IS-NOT-THE-BARCODE", 100, y + (qr ? 290 : 150));
  }
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((blob) => resolve(blob!), "image/png"),
  );
  return new File([blob], "synthetic-label.png", { type: "image/png" });
}
type Case = {
  name: string;
  file: File;
  target: BarcodeImageTarget;
  expected: string[];
};
declare global {
  interface Window {
    barcodeFixture: typeof barcodeFixture;
    runSyntheticBarcodeRegression: () => Promise<unknown[]>;
    syntheticBarcodeRegression: {
      running: boolean;
      rows: unknown[];
      error?: string;
    };
  }
}
window.barcodeFixture = barcodeFixture;
window.runSyntheticBarcodeRegression = async () => {
  const state: Window["syntheticBarcodeRegression"] =
    (window.syntheticBarcodeRegression = {
      running: true,
      rows: [] as unknown[],
    });
  try {
    const cases: Case[] = [
      {
        name: "product",
        file: await barcodeFixture(),
        target: "productBarcodeText",
        expected: ["DEMO-PRODUCT"],
      },
      {
        name: "JOB",
        file: await barcodeFixture(["FO12345678"]),
        target: "factoryOrder",
        expected: ["FO12345678"],
      },
      {
        name: "location Code128",
        file: await barcodeFixture(["F2-L28-18"]),
        target: "LOCATION",
        expected: ["F2-L28-18"],
      },
      {
        name: "location QR",
        file: await barcodeFixture(["F2-L28-18"], true),
        target: "LOCATION",
        expected: ["F2-L28-18"],
      },
      {
        name: "tilted product",
        file: await barcodeFixture(["DEMO-PRODUCT"], false, 8),
        target: "productBarcodeText",
        expected: ["DEMO-PRODUCT"],
      },
      {
        name: "multiple codes",
        file: await barcodeFixture(["ZONE-A", "ZONE-B"]),
        target: "LOCATION",
        expected: ["ZONE-A", "ZONE-B"],
      },
      {
        name: "printed text only",
        file: await barcodeFixture([]),
        target: "TICKET",
        expected: [],
      },
      {
        name: "JOB-only is not a product",
        file: await barcodeFixture(["FO12345678"]),
        target: "TICKET",
        expected: [],
      },
    ];
    for (const test of cases) {
      const result = await readBarcodeImage(
        test.file,
        test.target,
        new AbortController().signal,
      );
      state.rows.push({
        name: test.name,
        pass:
          JSON.stringify([...result.codes].sort()) ===
          JSON.stringify([...test.expected].sort()),
        ...result,
      });
    }
    return state.rows;
  } finally {
    state.running = false;
  }
};
