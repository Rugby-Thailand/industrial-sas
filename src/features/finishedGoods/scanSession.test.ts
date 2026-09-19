import { describe, expect, it } from "vitest";
import {
  assignmentSnapshot,
  canScanLocation,
  initialScanSession,
  scanReducer,
  type ScanSession,
  type ScanUnit,
} from "./scanSession";
const unit = (id: string, fillPercent?: number): ScanUnit => ({
  id,
  code: id,
  productName: "Product",
  version: 1,
  ...(fillPercent === undefined ? {} : { fillPercent }),
});
const add = (state: ScanSession, key: string) =>
  scanReducer(state, { type: "add", key, code: key });
const resolve = (state: ScanSession, key: string, id = key) =>
  scanReducer(state, {
    type: "resolve",
    key,
    generation: state.generation,
    unit: unit(id),
  });
describe("ordered scanning session", () => {
  it("retains detection order when responses finish out of order and submits changed order", () => {
    let s = add(add(add(initialScanSession(), "A"), "B"), "C");
    s = resolve(resolve(resolve(s, "C"), "B"), "A");
    expect(s.rows.map((r) => r.unit?.id)).toEqual(["A", "B", "C"]);
    s = scanReducer(s, { type: "move", key: "C", index: 1 });
    s = scanReducer(s, { type: "location" });
    s = scanReducer(s, {
      type: "detected",
      generation: s.generation,
      location: {
        zoneId: "z",
        version: "v",
        code: "z",
        name: "Zone",
        method: "SCAN",
      },
    });
    expect(
      assignmentSnapshot(s, "w", "request").units.map((u) => u.unitId),
    ).toEqual(["A", "C", "B"]);
  });
  it("retains earlier detection for aliases even when it resolves last", () => {
    let s = add(add(initialScanSession(), "label"), "qr");
    s = resolve(s, "qr", "one");
    s = resolve(s, "label", "one");
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]!.key).toBe("label");
  });
  it("does not resurrect removed rows and allows deliberate rescan", () => {
    let s = add(initialScanSession(), "A");
    s = scanReducer(s, { type: "remove", key: "A" });
    s = resolve(s, "A");
    expect(s.rows).toHaveLength(0);
    s = add(s, "A");
    expect(s.rows).toHaveLength(1);
  });
  it("blocks pending, invalid and empty groups", () => {
    expect(canScanLocation(initialScanSession())).toBe(false);
    let s = add(initialScanSession(), "A");
    expect(canScanLocation(s)).toBe(false);
    s = resolve(s, "A");
    s = scanReducer(s, { type: "fill", value: "25.5" });
    expect(canScanLocation(s)).toBe(false);
    s = scanReducer(s, { type: "fill", value: "" });
    expect(canScanLocation(s)).toBe(false);
    s = scanReducer(s, { type: "fill", value: "50" });
    expect(canScanLocation(s)).toBe(true);
  });
  it("invalidates old mode callbacks and preserves list on returning", () => {
    let s = resolve(add(initialScanSession(), "A"), "A");
    s = scanReducer(s, { type: "location" });
    const old = s.generation;
    s = scanReducer(s, { type: "back" });
    s = scanReducer(s, {
      type: "detected",
      generation: old,
      location: {
        zoneId: "z",
        version: "v",
        code: "z",
        name: "Zone",
        method: "SCAN",
      },
    });
    expect(s.mode).toBe("PACKAGES");
    expect(s.location).toBeUndefined();
    expect(s.rows).toHaveLength(1);
  });
  it("preserves preparation exceptions and freezes snapshots independently", () => {
    let s = add(initialScanSession(), "A");
    s = scanReducer(s, {
      type: "resolve",
      key: "A",
      generation: 0,
      unit: unit("A", 25),
    });
    s = scanReducer(s, { type: "location" });
    s = scanReducer(s, {
      type: "detected",
      generation: s.generation,
      location: {
        zoneId: "z",
        version: "v",
        code: "z",
        name: "Zone",
        method: "MANUAL",
      },
    });
    const snapshot = assignmentSnapshot(s, "w", "retry");
    s = scanReducer(s, { type: "submit" });
    s = scanReducer(s, { type: "remove", key: "A" });
    expect(s.rows).toHaveLength(1);
    expect(snapshot.units[0]!.fillPercent).toBe(25);
    expect(snapshot.location.method).toBe("MANUAL");
  });
  it("refuses the 51st unit without truncation", () => {
    let s = initialScanSession();
    for (let i = 0; i < 51; i++) s = add(s, String(i));
    expect(s.rows).toHaveLength(50);
    expect(s.rows[49]!.key).toBe("49");
  });
});

it("keeps canonical location display separate from raw QR evidence", () => {
  let state = resolve(add(initialScanSession(), "A"), "A");
  state = scanReducer(state, { type: "location" });
  state = scanReducer(state, {
    type: "detected",
    generation: state.generation,
    location: {
      zoneId: "z",
      version: "v",
      code: "ZONE-1",
      rawCode: "ISAS:ZONE:1:unique",
      name: "Zone",
      method: "SCAN",
    },
  });
  expect(state.location?.code).toBe("ZONE-1");
  expect(assignmentSnapshot(state, "w", "r").location.code).toBe(
    "ISAS:ZONE:1:unique",
  );
});

it("keeps a user fullness edit when an earlier alias finishes later", () => {
  let state = add(add(initialScanSession(), "first"), "alias");
  state = scanReducer(state, {
    type: "resolve",
    key: "alias",
    generation: 0,
    unit: unit("A", 25),
  });
  state = scanReducer(state, { type: "fill", key: "alias", value: "75" });
  state = scanReducer(state, {
    type: "resolve",
    key: "first",
    generation: 0,
    unit: unit("A", 25),
  });
  expect(state.rows[0]?.fill).toBe("75");
  expect(state.rows[0]?.key).toBe("first");
});
it("preserves explicitly cleared exceptions during alias merging and applies a group value to every unit", () => {
  let state = add(add(initialScanSession(), "first"), "alias");
  state = scanReducer(state, {
    type: "resolve",
    key: "alias",
    generation: 0,
    unit: unit("A", 25),
  });
  state = scanReducer(state, { type: "fill", key: "alias", value: "" });
  state = scanReducer(state, {
    type: "resolve",
    key: "first",
    generation: 0,
    unit: unit("A", 25),
  });
  expect(state.rows[0]?.fill).toBeUndefined();
  state = add(state, "B");
  state = scanReducer(state, { type: "fill", value: "50" });
  state = scanReducer(state, { type: "applyFill" });
  state = scanReducer(state, {
    type: "resolve",
    key: "B",
    generation: 0,
    unit: unit("B", 75),
  });
  expect(state.rows.every((row) => row.fill === undefined)).toBe(true);
});
it("merges saved mixed-size answers independent of resolution order without overriding a worker answer", () => {
  let state = add(add(initialScanSession(), "A"), "B");
  state = scanReducer(state, {
    type: "resolve",
    key: "B",
    generation: 0,
    unit: { ...unit("B"), sameSize: false },
  });
  state = resolve(state, "A");
  expect(state.sameSize).toBe(false);
  state = scanReducer(state, { type: "remove", key: "B" });
  expect(state.sameSize).toBe(true);
  state = scanReducer(state, { type: "size", value: false });
  state = scanReducer(state, { type: "remove", key: "A" });
  expect(state.sameSize).toBe(false);
});
