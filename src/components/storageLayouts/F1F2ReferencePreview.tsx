"use client";

import { useState } from "react";

const revision = "f1-f2-2026-09-25";
const buildingId = "n575kryc3hp4e788hyc7pab4hh8f1vgv";

export function matchesF1F2Reference(
  candidateBuildingId: string | undefined,
  floorNumber: number,
  approvedRevision: string | undefined,
) {
  return (
    candidateBuildingId === buildingId &&
    (floorNumber === 1 || floorNumber === 2) &&
    approvedRevision === revision
  );
}

/** Presentation drawing; operational locations and millimetre geometry remain in Convex. */
export function F1F2ReferencePreview({
  floorNumber,
}: {
  readonly floorNumber: number;
}) {
  const [view, setView] = useState<"2D" | "3D">("2D");
  const floor = floorNumber === 1 ? "f1" : "f2";
  const src = `/f1-f2-reference/${floor}-${view.toLowerCase()}.html`;

  return (
    <section
      aria-label={`ผังสรุปอาคาร F1 + F2 ชั้น ${floorNumber}`}
      className="min-w-0 overflow-hidden rounded-2xl border border-border bg-[#0b0d11]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 text-white sm:px-6">
        <div>
          <h2 className="text-lg font-semibold">
            อาคาร F1 + F2 · ชั้น {floorNumber} (
            {floorNumber === 1 ? "F1" : "F2"})
          </h2>
          <p className="text-sm text-slate-300">
            ผังสรุปจาก PDF หน้า {floorNumber === 1 ? "3" : "4"} · กดกลุ่มใน 2D
            เพื่อดูช่องย่อย
          </p>
        </div>
        <div
          className="flex rounded-xl border border-slate-600 bg-slate-900 p-1"
          role="group"
          aria-label="มุมมองผัง"
        >
          {(["2D", "3D"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              className={`rounded-lg px-5 py-2 text-sm font-semibold ${view === option ? "bg-slate-700 text-blue-200" : "text-slate-300 hover:bg-slate-800"}`}
              onClick={() => setView(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <iframe
          key={src}
          title={`ผัง ${view} อาคาร F1 + F2 ชั้น ${floorNumber}`}
          src={src}
          sandbox="allow-scripts"
          loading="lazy"
          style={{
            display: "block",
            width: "100%",
            minWidth: 1050,
            height:
              view === "3D"
                ? "max(700px, min(63vw, 980px))"
                : floorNumber === 2
                  ? "max(800px, min(80vw, 1160px))"
                  : "max(760px, min(70vw, 1000px))",
            border: 0,
            background: "#0b0d11",
          }}
        />
      </div>
      <p className="px-4 pb-4 text-xs text-slate-300 sm:px-6">
        {view === "3D"
          ? "ความสูงของกล่องเป็นภาพจำลอง ไม่ใช่ความสูงสำหรับคำนวณความจุ"
          : "ผังนี้เป็นภาพสรุป; พิกัดใช้งานจริงและรหัส Location เดิมอยู่ในฐานข้อมูล"}
      </p>
    </section>
  );
}
