"use client";

export {
  metres,
  millimetres,
  squareMetres,
} from "@/lib/storageLayouts/storageKit";

/** Client-only identity for a newly drafted reserved block, not a command key. */
export const localEntityId = () => crypto.randomUUID();

export function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-text tabular-nums">{value}</dd>
    </div>
  );
}
