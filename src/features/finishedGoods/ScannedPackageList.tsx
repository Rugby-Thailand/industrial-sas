"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFGText } from "./shared";
import { rowFill, type ScanSession, type ScanEvent } from "./scanSession";
export function ScannedPackageList({
  state,
  dispatch,
  readOnly = false,
}: {
  state: ScanSession;
  dispatch: (event: ScanEvent) => void;
  readOnly?: boolean;
}) {
  const { tr } = useFGText();
  const reorderHintId = useId();
  const list = useRef<HTMLOListElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const pointerY = useRef(0);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const targetAt = (y: number) => {
    const rows = Array.from(list.current?.querySelectorAll("li") ?? []);
    const index = rows.findIndex(
      (element) => y < element.getBoundingClientRect().bottom,
    );
    return index < 0 ? rows.length - 1 : index;
  };
  const cancelDrag = () => {
    setDragging(null);
    setDropTarget(null);
  };
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const y = pointerY.current;
      const edge = 100;
      const speed =
        y < edge
          ? -Math.min(18, (edge - y) / 4)
          : y > window.innerHeight - edge
            ? Math.min(18, (y - window.innerHeight + edge) / 4)
            : 0;
      if (speed) window.scrollBy(0, speed);
      setDropTarget(targetAt(y));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);
  const move = (key: string, index: number) => {
    if (index < 0 || index >= state.rows.length) return;
    dispatch({ type: "move", key, index });
    setAnnouncement(
      tr(`Moved to position ${index + 1}`, `ย้ายไปลำดับ ${index + 1}`),
    );
  };
  return (
    <>
      <p id={reorderHintId} className="sr-only">
        {tr(
          "Drag to reorder, or use the up and down arrow keys.",
          "ลากเพื่อเรียงลำดับ หรือใช้ปุ่มลูกศรขึ้นและลง",
        )}
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <ol
        ref={list}
        className="space-y-3"
        aria-label={tr("Packages, top to bottom", "พัสดุ เรียงจากบนลงล่าง")}
      >
        {state.rows.map((row, index) => (
          <li
            key={row.key}
            data-scan-row={row.key}
            className={`rounded-xl border p-4 ${dragging === row.key ? "border-accent bg-accent/10" : "border-border bg-surface"}`}
          >
            {dragging && dropTarget === index && (
              <p className="mb-2 border-t-4 border-accent pt-2 text-sm font-semibold">
                {tr(
                  `Drop at position ${index + 1}`,
                  `วางที่ลำดับ ${index + 1}`,
                )}
              </p>
            )}
            <div className="flex items-start gap-3">
              <span className="min-w-14 text-center text-3xl font-bold tabular-nums">
                {index + 1}
                <span className="block text-xs font-medium">
                  {index === 0 ? tr("Top", "บนสุด") : ""}
                  {index === 0 && state.rows.length === 1 ? " / " : ""}
                  {index === state.rows.length - 1
                    ? tr("Bottom", "ล่างสุด")
                    : ""}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold break-all">
                  {row.unit?.code ?? row.code}
                </p>
                <p className="text-sm text-muted">
                  {row.status === "pending"
                    ? tr("Checking…", "กำลังตรวจสอบ…")
                    : row.status === "error"
                      ? row.error
                      : row.unit?.productName}
                </p>
                {row.status === "ready" && (
                  <p className="text-sm">
                    {rowFill(state, row)}% {tr("full", "เต็ม")}
                  </p>
                )}
              </div>
              {!readOnly && (
                <button
                  type="button"
                  className="min-h-11 min-w-11 touch-none rounded-lg border border-border text-xl"
                  aria-label={tr(
                    `Drag ${row.unit?.code ?? row.code} to reorder`,
                    `ลาก ${row.unit?.code ?? row.code} เพื่อเรียงลำดับ`,
                  )}
                  aria-describedby={reorderHintId}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    pointerY.current = e.clientY;
                    setDropTarget(index);
                    setDragging(row.key);
                  }}
                  onPointerMove={(e) => {
                    if (!dragging) return;
                    pointerY.current = e.clientY;
                    setDropTarget(targetAt(e.clientY));
                  }}
                  onPointerUp={(e) => {
                    if (dragging) move(dragging, targetAt(e.clientY));
                    cancelDrag();
                  }}
                  onPointerCancel={cancelDrag}
                  onLostPointerCapture={cancelDrag}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") cancelDrag();
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                      e.preventDefault();
                      cancelDrag();
                      move(row.key, index + (e.key === "ArrowUp" ? -1 : 1));
                    }
                  }}
                >
                  ⠿
                </button>
              )}
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  className="size-11 shrink-0 text-danger hover:text-danger"
                  aria-label={tr(
                    `Remove ${row.unit?.code ?? row.code}`,
                    `ลบ ${row.unit?.code ?? row.code}`,
                  )}
                  onClick={() => {
                    dispatch({ type: "remove", key: row.key });
                    setAnnouncement(tr("Package removed", "ลบพัสดุแล้ว"));
                    requestAnimationFrame(() =>
                      list.current
                        ?.querySelector<HTMLButtonElement>("button")
                        ?.focus(),
                    );
                  }}
                >
                  <Trash2 aria-hidden="true" className="size-5" />
                </Button>
              )}
            </div>
            {!readOnly && row.status === "ready" && (
              <label className="mt-3 flex items-center gap-2 text-sm">
                {tr("Exception %", "เปอร์เซ็นต์เฉพาะชิ้น")}
                <Input
                  className="min-h-11 w-24"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  placeholder={state.fill}
                  value={row.fill ?? ""}
                  onChange={(e) =>
                    dispatch({
                      type: "fill",
                      key: row.key,
                      value: e.target.value,
                    })
                  }
                />
              </label>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
