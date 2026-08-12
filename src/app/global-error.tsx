"use client";

import { useEffect } from "react";

import { useObservability } from "@/components/providers/ObservabilityProvider";
import { applicationRenderErrorEvent } from "@/lib/observability/applicationError";

/**
 * Last-resort boundary for failures that replace the locale root layout itself.
 *
 * It owns its `<html>` and `<body>` and carries bilingual literal copy because
 * neither next-intl nor the application's provider stack is guaranteed to exist
 * at this level. Inline critical styles keep the recovery control readable even
 * when the layout that imports the global stylesheet is the thing that failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  const observability = useObservability();

  useEffect(() => {
    void error;
    observability.record(applicationRenderErrorEvent("global", Date.now()));
  }, [error, observability]);

  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          boxSizing: "border-box",
          color: "#17202a",
          background: "#f6f7f9",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main
          role="alert"
          aria-labelledby="global-error-title"
          style={{
            width: "min(100%, 560px)",
            padding: "24px",
            border: "1px solid #b42318",
            borderLeftWidth: "4px",
            borderRadius: "12px",
            background: "#ffffff",
          }}
        >
          <h1
            id="global-error-title"
            style={{ margin: 0, fontSize: "1.25rem" }}
          >
            เกิดข้อผิดพลาดที่ไม่คาดคิด / Unexpected error
          </h1>
          <p style={{ margin: "12px 0 0", lineHeight: 1.6 }}>
            หน้าจอนี้ทำงานต่อไม่ได้ กรุณาลองใหม่ / This screen could not
            continue. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minWidth: "48px",
              minHeight: "48px",
              marginTop: "20px",
              padding: "0 20px",
              border: 0,
              borderRadius: "8px",
              color: "#ffffff",
              background: "#1859a9",
              font: "inherit",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ลองใหม่ / Try again
          </button>
        </main>
      </body>
    </html>
  );
}
