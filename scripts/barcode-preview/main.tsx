import { useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import en from "../../messages/en.json";
import th from "../../messages/th.json";
import { JobScanScreen } from "@/features/finishedGoods/jobScan/JobScanScreen";
import { readBarcodeImage } from "@/features/finishedGoods/barcodeImage";
import { previewCalls } from "./adapters";
import "./regression";
import "./synthetic";
import "../../src/app/globals.css";

declare global {
  interface Window {
    barcodePreview: {
      readBarcodeImage: typeof readBarcodeImage;
      calls: typeof previewCalls;
    };
  }
}
window.barcodePreview = { readBarcodeImage, calls: previewCalls };
function App() {
  const [locale, setLocale] = useState<"en" | "th">("en"),
    [dark, setDark] = useState(true);
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : th}
    >
      <div className="border-b border-border bg-surface p-3 text-sm">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <p>Local verification · Real components, sample backend</p>
          <div className="flex gap-2">
            <button
              className="min-h-12 rounded border border-border-strong px-3"
              onClick={() => {
                const next = locale === "en" ? "th" : "en";
                document.documentElement.lang = next;
                setLocale(next);
              }}
            >
              {locale === "en" ? "ไทย" : "English"}
            </button>
            <button
              className="min-h-12 rounded border border-border-strong px-3"
              onClick={() => {
                document.documentElement.className = dark ? "light" : "dark";
                setDark(!dark);
              }}
            >
              Light / dark
            </button>
          </div>
        </div>
      </div>
      <JobScanScreen />
    </NextIntlClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
