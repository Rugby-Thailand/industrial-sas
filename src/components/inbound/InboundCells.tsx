import type { ReactNode } from "react";

import { formatMinorUnits, UNRENDERABLE } from "@/lib/formatters";

export const withUnit = (minorUnits: number, uom: string): string =>
  `${formatMinorUnits(minorUnits, uom)} ${uom}`;

export const withBaseUnit = (
  minorUnits: number,
  baseUom: string | undefined,
): string =>
  baseUom === undefined ? UNRENDERABLE : withUnit(minorUnits, baseUom);

export const identifier = (value: string | undefined): ReactNode =>
  value === undefined || value.length === 0 ? (
    UNRENDERABLE
  ) : (
    <span className="whitespace-nowrap" title={value}>
      {value}
    </span>
  );
