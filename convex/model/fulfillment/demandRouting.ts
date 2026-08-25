export type DemandRouteDecision = "AVAILABLE_STOCK" | "PRODUCTION";
export type AggregateRouteDecision = DemandRouteDecision | "MIXED";

export type DemandRoute = Readonly<{
  decision: DemandRouteDecision;
  productionShortageBaseMinorUnits: number;
}>;

export function decideDemandRoute(input: {
  readonly orderedBaseMinorUnits: number;
  readonly atpBaseMinorUnits: number;
}):
  | { readonly ok: true; readonly value: DemandRoute }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "FIELD_INVALID";
        readonly field: "orderedBaseMinorUnits" | "atpBaseMinorUnits";
        readonly reason: "INVALID_MINOR_UNITS";
      };
    } {
  for (const field of ["orderedBaseMinorUnits", "atpBaseMinorUnits"] as const) {
    const value = input[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      return {
        ok: false,
        error: { code: "FIELD_INVALID", field, reason: "INVALID_MINOR_UNITS" },
      };
    }
  }
  if (input.orderedBaseMinorUnits === 0) {
    return {
      ok: false,
      error: {
        code: "FIELD_INVALID",
        field: "orderedBaseMinorUnits",
        reason: "INVALID_MINOR_UNITS",
      },
    };
  }
  const shortage = Math.max(
    0,
    input.orderedBaseMinorUnits - input.atpBaseMinorUnits,
  );
  return {
    ok: true,
    value: Object.freeze({
      decision: shortage === 0 ? "AVAILABLE_STOCK" : "PRODUCTION",
      productionShortageBaseMinorUnits: shortage,
    }),
  };
}

export function mergeRouteDecision(
  current: AggregateRouteDecision,
  next: DemandRouteDecision,
): AggregateRouteDecision {
  return current === next ? current : "MIXED";
}
