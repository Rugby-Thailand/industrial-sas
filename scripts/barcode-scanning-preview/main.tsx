import { useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { BarcodeFormat, QRCodeWriter } from "@zxing/library";
import { decodeBarcodeImage } from "@/features/finishedGoods/barcodeDecoder";
import { BarcodeCameraBox } from "@/features/finishedGoods/BarcodeCameraBox";
import {
  LocationImageReader,
  locationPhoto,
  type LocationPhoto,
} from "@/features/finishedGoods/jobScan/LocationImageReader";
import type { LocationImageResult } from "../../convex/model/finishedGoods/locationImage";
import { messagesFor } from "@/i18n/messages";
import "../../src/app/globals.css";

const fixtures = [
  { path: "/location-1.webp", expected: "F2-L28-1" },
  { path: "/location-18.webp", expected: "F2-L28-18" },
  { path: "/location-18.png", expected: "F2-L28-18" },
  { path: "/location-4-2.png", expected: "F1-L4-2" },
  { path: "/location-3-11.png", expected: "F1-L3-11" },
  { path: "/location-22-2.webp", expected: "F1-L22-2" },
];

declare global {
  interface Window {
    runBarcodePhotoRegression: () => Promise<unknown>;
    barcodeFixtureStreams: MediaStream[];
    selectGeneratedBarcodePhoto: (kind: "qr" | "multiple") => Promise<void>;
    locationAiResponse: LocationImageResult;
    locationAiDelay: number;
    locationAiCompleted: number;
    locationAiRequests: {
      length: number;
      prefix: string;
      width: number;
      height: number;
    }[];
  }
}
window.barcodeFixtureStreams = [];
// The provider port is deliberately synthetic; acquisition, preprocessing,
// candidate review and source switching use the real production components.
window.locationAiResponse = {
  ok: true,
  candidates: [{ code: "F1-L3-11", labelText: null }],
};
window.locationAiDelay = 0;
window.locationAiCompleted = 0;
window.locationAiRequests = [];

// Generated test images exercise QR compatibility and ambiguous photos using
// the real file-input path, rather than replacing the production decoder.
window.selectGeneratedBarcodePhoto = async (kind) => {
  const canvas = document.createElement("canvas");
  canvas.width = kind === "qr" ? 320 : 3172;
  canvas.height = kind === "qr" ? 320 : 2048;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (kind === "qr") {
    const matrix = new QRCodeWriter().encode(
      "F1-L3",
      BarcodeFormat.QR_CODE,
      320,
      320,
      new Map(),
    );
    context.fillStyle = "black";
    for (let y = 0; y < matrix.getHeight(); y++)
      for (let x = 0; x < matrix.getWidth(); x++)
        if (matrix.get(x, y)) context.fillRect(x, y, 1, 1);
  } else {
    for (const [index, fixture] of fixtures.slice(0, 2).entries()) {
      const image = new Image();
      image.src = fixture.path;
      await image.decode();
      context.drawImage(image, index * 1636, 0);
    }
  }
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((value) => resolve(value!), "image/png"),
  );
  const files = new DataTransfer();
  files.items.add(new File([blob], `${kind}.png`, { type: "image/png" }));
  const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
  input.files = files.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

async function installFixtureCamera() {
  const fixture = fixtures.find(
    (item) =>
      item.path.slice(1) === new URLSearchParams(location.search).get("camera"),
  );
  if (!fixture) return;
  const image = new Image();
  image.src = fixture.path;
  await image.decode();
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
    configurable: true,
    value: async () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const stream = canvas.captureStream(8);
      const timer = setInterval(() => context.drawImage(image, 0, 0), 125);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => {
          clearInterval(timer);
          stop();
        };
      }
      window.barcodeFixtureStreams.push(stream);
      return stream;
    },
  });
}
window.runBarcodePhotoRegression = async () => {
  const results = [];
  for (const fixture of fixtures) {
    const response = await fetch(fixture.path);
    const blob = await response.blob();
    const file = new File([blob], fixture.path, { type: blob.type });
    let codes: string[] = [];
    try {
      codes = await decodeBarcodeImage(file);
    } catch {
      // A missing result is a failing fixture, rather than a harness crash.
    }
    results.push({
      ...fixture,
      codes,
      pass: codes.length === 1 && codes[0] === fixture.expected,
    });
  }
  return results;
};

function App() {
  const locale =
    new URLSearchParams(location.search).get("locale") === "th" ? "th" : "en";
  const [codes, setCodes] = useState<string[]>([]);
  const [ai, setAi] = useState<{ photo?: LocationPhoto }>();
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messagesFor(locale)}
      timeZone="Asia/Bangkok"
    >
      <main className="mx-auto max-w-xl space-y-4 p-4">
        <h1 className="text-xl font-semibold">Barcode scanning</h1>
        {ai ? (
          <LocationImageReader
            {...(ai.photo ? { initialPhoto: ai.photo } : {})}
            extract={async (imageDataUrl) => {
              const bitmap = await createImageBitmap(
                await (await fetch(imageDataUrl)).blob(),
              );
              window.locationAiRequests.push({
                length: imageDataUrl.length,
                prefix: imageDataUrl.slice(0, 23),
                width: bitmap.width,
                height: bitmap.height,
              });
              bitmap.close();
              const result = window.locationAiResponse;
              await new Promise((resolve) =>
                setTimeout(resolve, window.locationAiDelay),
              );
              window.locationAiCompleted++;
              return result;
            }}
            onConfirm={(code) => {
              setCodes((items) => [...items, code]);
              setAi(undefined);
            }}
            onClose={() => setAi(undefined)}
          />
        ) : (
          <BarcodeCameraBox
            mode="LOCATION"
            startOnMount={new URLSearchParams(location.search).has("camera")}
            stopAfterScan={new URLSearchParams(location.search).has("camera")}
            onCode={(code) => setCodes((items) => [...items, code])}
            onReadWithAi={(file, crop) =>
              setAi(file ? { photo: locationPhoto(file, crop) } : {})
            }
          />
        )}
        <output aria-label="Decoded codes">{codes.join(", ")}</output>
      </main>
    </NextIntlClientProvider>
  );
}
void installFixtureCamera().then(() =>
  createRoot(document.getElementById("root")!).render(<App />),
);
