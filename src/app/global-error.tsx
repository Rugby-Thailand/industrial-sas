"use client";

import { useEffect } from "react";

import { useObservability } from "@/components/providers/ObservabilityProvider";
import { Button } from "@/components/ui/button";
import { applicationRenderErrorEvent } from "@/lib/observability/applicationError";

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
    <html lang="th" style={{ colorScheme: "light dark" }}>
      <head>
        <style>{`
          :root {
            --global-error-canvas: #f3f5f7;
            --global-error-surface: #ffffff;
            --global-error-text: #12161c;
            --global-error-danger: #b3261e;
            --global-error-accent: #0b5cad;
            --global-error-accent-text: #ffffff;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --global-error-canvas: #0b0e12;
              --global-error-surface: #303b48;
              --global-error-text: #eef1f5;
              --global-error-danger: #ffaaa2;
              --global-error-accent: #86bdff;
              --global-error-accent-text: #071522;
            }
          }
        `}</style>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          boxSizing: "border-box",
          color: "var(--global-error-text)",
          background: "var(--global-error-canvas)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main
          role="alert"
          aria-labelledby="global-error-title"
          style={{
            width: "min(100%, 560px)",
            padding: "24px",
            border: "1px solid var(--global-error-danger)",
            borderLeftWidth: "4px",
            borderRadius: "12px",
            background: "var(--global-error-surface)",
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
          <Button
            type="button"
            onClick={reset}
            variant="default"
            size="touch"
            className="mt-5 border-0 font-bold"
            style={{
              color: "var(--global-error-accent-text)",
              background: "var(--global-error-accent)",
            }}
          >
            ลองใหม่ / Try again
          </Button>
        </main>
      </body>
    </html>
  );
}
