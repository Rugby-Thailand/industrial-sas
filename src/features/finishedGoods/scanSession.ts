/** A row's detection ordinal survives sorting and asynchronous identity resolution. */
export type ScanUnit = {
  id: string;
  code: string;
  productName: string;
  version: number;
  sameSize?: boolean;
  fillPercent?: number;
};
export type ScanLocation = {
  zoneId: string;
  supportPositionId?: string;
  version: string;
  code: string;
  name: string;
};
export type ScanRow = {
  key: string;
  ordinal: number;
  code: string;
  status: "pending" | "ready" | "error";
  unit?: ScanUnit;
  error?: string;
  fill?: string | undefined;
  fillEdited?: boolean;
};
export type ScanSession = {
  mode:
    | "PACKAGES"
    | "LOCATION_SCANNING"
    | "LOCATION_DETECTED"
    | "SUBMITTING"
    | "COMPLETED";
  generation: number;
  nextOrdinal: number;
  rows: ScanRow[];
  sameSize: boolean;
  sizeEdited: boolean;
  fill: string;
  location?:
    | (ScanLocation & { method: "SCAN" | "MANUAL"; rawCode?: string })
    | undefined;
};
export const initialScanSession = (): ScanSession => ({
  mode: "PACKAGES",
  generation: 0,
  nextOrdinal: 0,
  rows: [],
  sameSize: true,
  sizeEdited: false,
  fill: "100",
});
export const validFill = (value: string) =>
  value.trim() !== "" &&
  Number.isInteger(Number(value)) &&
  Number(value) >= 1 &&
  Number(value) <= 100;
export const rowFill = (state: ScanSession, row: ScanRow) =>
  row.fill ?? state.fill;
export const canScanLocation = (state: ScanSession) =>
  state.rows.length > 0 &&
  validFill(state.fill) &&
  state.rows.every(
    (row) => row.status === "ready" && validFill(rowFill(state, row)),
  );
export type ScanEvent =
  | { type: "add"; key: string; code: string }
  | { type: "resolve"; key: string; generation: number; unit: ScanUnit }
  | { type: "error"; key: string; generation: number; error: string }
  | { type: "remove"; key: string }
  | { type: "move"; key: string; index: number }
  | { type: "fill"; value: string; key?: string }
  | { type: "size"; value: boolean }
  | { type: "applyFill" }
  | { type: "location" }
  | { type: "detected"; location: ScanSession["location"]; generation: number }
  | { type: "back" | "rescan" | "submit" | "failed" | "complete" };
export function scanReducer(state: ScanSession, event: ScanEvent): ScanSession {
  if (event.type === "complete") return { ...state, mode: "COMPLETED" };
  if (event.type === "failed") return { ...state, mode: "LOCATION_DETECTED" };
  if (event.type === "submit")
    return state.mode === "LOCATION_DETECTED"
      ? { ...state, mode: "SUBMITTING" }
      : state;
  if (state.mode === "SUBMITTING" || state.mode === "COMPLETED") return state;
  if (event.type === "back" || event.type === "rescan")
    return {
      ...state,
      mode: event.type === "back" ? "PACKAGES" : "LOCATION_SCANNING",
      generation: state.generation + 1,
      location: undefined,
    };
  if (event.type === "detected")
    return state.mode === "LOCATION_SCANNING" &&
      event.generation === state.generation
      ? {
          ...state,
          mode: "LOCATION_DETECTED",
          location: event.location,
          generation: state.generation + 1,
        }
      : state;
  if (state.mode !== "PACKAGES") return state;
  switch (event.type) {
    case "add":
      return state.rows.length >= 50 ||
        state.rows.some((r) => r.code === event.code)
        ? state
        : {
            ...state,
            nextOrdinal: state.nextOrdinal + 1,
            rows: [
              ...state.rows,
              {
                key: event.key,
                ordinal: state.nextOrdinal,
                code: event.code,
                status: "pending",
              },
            ],
          };
    case "resolve": {
      if (event.generation !== state.generation) return state;
      const target = state.rows.find((r) => r.key === event.key);
      if (!target) return state;
      const matching = state.rows.filter(
        (r) => r.unit?.id === event.unit.id || r.key === event.key,
      );
      const first = matching.reduce((a, b) => (a.ordinal < b.ordinal ? a : b));
      const edited = matching.find((row) => row.fillEdited);
      const saved = matching.find((row) => row.status === "ready");
      return {
        ...state,
        sameSize:
          !state.sizeEdited && event.unit.sameSize === false
            ? false
            : state.sameSize,
        rows: state.rows
          .filter((r) => !matching.includes(r) || r.key === first.key)
          .map((r) =>
            r.key === first.key
              ? {
                  ...r,
                  status: "ready",
                  unit: event.unit,
                  fillEdited: Boolean(edited),
                  fill: edited
                    ? edited.fill
                    : (r.fill ??
                      saved?.fill ??
                      (event.unit.fillPercent === undefined
                        ? undefined
                        : String(event.unit.fillPercent))),
                }
              : r,
          ),
      };
    }
    case "error":
      return event.generation !== state.generation
        ? state
        : {
            ...state,
            rows: state.rows.map((r) =>
              r.key === event.key
                ? { ...r, status: "error", error: event.error }
                : r,
            ),
          };
    case "remove": {
      const rows = state.rows.filter((r) => r.key !== event.key);
      return {
        ...state,
        rows,
        sameSize: state.sizeEdited
          ? state.sameSize
          : !rows.some((row) => row.unit?.sameSize === false),
      };
    }
    case "applyFill":
      return validFill(state.fill)
        ? {
            ...state,
            rows: state.rows.map((row) => ({
              ...row,
              fill: undefined,
              fillEdited: true,
            })),
          }
        : state;
    case "move": {
      const rows = [...state.rows];
      const index = rows.findIndex((r) => r.key === event.key);
      if (index < 0) return state;
      const [row] = rows.splice(index, 1);
      rows.splice(Math.max(0, Math.min(event.index, rows.length)), 0, row!);
      return { ...state, rows };
    }
    case "fill":
      return event.key
        ? {
            ...state,
            rows: state.rows.map((r) =>
              r.key === event.key
                ? { ...r, fill: event.value || undefined, fillEdited: true }
                : r,
            ),
          }
        : { ...state, fill: event.value };
    case "size":
      return { ...state, sameSize: event.value, sizeEdited: true };
    case "location":
      return canScanLocation(state)
        ? {
            ...state,
            mode: "LOCATION_SCANNING",
            generation: state.generation + 1,
          }
        : state;
    default:
      return state;
  }
}
export function assignmentSnapshot(
  state: ScanSession,
  warehouseId: string,
  requestId: string,
) {
  if (!state.location || !canScanLocation(state))
    throw new Error("INVALID_INPUT");
  return {
    warehouseId,
    requestId,
    units: state.rows.map((row) => ({
      unitId: row.unit!.id,
      version: row.unit!.version,
      fillPercent: Number(rowFill(state, row)),
    })),
    location: {
      zoneId: state.location.zoneId,
      ...(state.location.supportPositionId
        ? { supportPositionId: state.location.supportPositionId }
        : {}),
      version: state.location.version,
      code: state.location.rawCode ?? state.location.code,
      method: state.location.method,
    },
    sameSize: state.sameSize,
    physicalConfirmed: true as const,
  };
}
