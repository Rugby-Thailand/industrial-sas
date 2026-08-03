/**
 * Unit tier — structural guards and runtime-immutable containers.
 *
 * These are the primitives every other module's fail-closed behaviour rests on,
 * so the cases worth writing down are the ones that would make a caller's
 * validation silently vacuous: a guard that narrows a value it should not, a
 * "frozen" container that is not, and a lookup that answers with something from
 * the prototype chain.
 */
import { describe, expect, it } from "vitest";

import {
  frozenArray,
  frozenRecord,
  isArray,
  isBoolean,
  isFunction,
  isRecord,
  isSafeInt,
  isString,
  recordKeys,
  recordValue,
} from "./guards";

describe("guards", () => {
  it("narrows strings, booleans, functions, and safe integers only", () => {
    expect([isString("a"), isString(1), isString(null)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([isBoolean(false), isBoolean("false"), isBoolean(0)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([
      isFunction(() => 1),
      isFunction("() => 1"),
      isFunction(null),
    ]).toEqual([true, false, false]);
    expect([
      isSafeInt(0),
      isSafeInt(-1),
      isSafeInt(1.5),
      isSafeInt(2 ** 53),
      isSafeInt(Number.NaN),
      isSafeInt(Number.POSITIVE_INFINITY),
      isSafeInt("1"),
      isSafeInt(null),
    ]).toEqual([true, true, false, false, false, false, false, false]);
  });

  it("treats null as not a record, so a field read cannot throw", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("a")).toBe(false);
  });

  it("recognises an array without widening its element type", () => {
    expect(isArray([1, 2])).toBe(true);
    expect(isArray("12")).toBe(false);
    expect(isArray({ length: 2 })).toBe(false);
  });
});

describe("frozenArray", () => {
  it("copies and freezes, so the source cannot be edited afterwards", () => {
    const source = [1, 2];
    const frozen = frozenArray(source);
    source.push(3);
    expect(frozen).toEqual([1, 2]);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(() => {
      (frozen as number[]).push(4);
    }).toThrow(TypeError);
  });
});

describe("frozenRecord", () => {
  const record = frozenRecord([
    ["01", "gtin"],
    ["10", "lot"],
  ]);

  it("is immutable at run time, not only in the type", () => {
    expect(Object.isFrozen(record)).toBe(true);
    expect(() => {
      (record as Record<string, string>)["17"] = "expiry";
    }).toThrow(TypeError);
    expect(() => {
      (record as Record<string, string>)["01"] = "changed";
    }).toThrow(TypeError);
    expect(record["01"]).toBe("gtin");
  });

  it("has no prototype, so a lookup answers only what was put in", () => {
    // With `Object.prototype` in the chain, `record["toString"]` answers a
    // function while the type promises a string — a lie a scanned key could
    // trigger.
    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(record["toString"]).toBeUndefined();
    expect(recordValue(record, "toString")).toBeNull();
    expect(recordValue(record, "__proto__")).toBeNull();
    expect(recordValue(record, "01")).toBe("gtin");
    expect(recordValue(record, "99")).toBeNull();
    expect(recordValue(record, 1 as unknown as string)).toBeNull();
  });

  it("enumerates its keys sorted and frozen", () => {
    expect(recordKeys(record)).toEqual(["01", "10"]);
    expect(Object.isFrozen(recordKeys(record))).toBe(true);
  });
});
