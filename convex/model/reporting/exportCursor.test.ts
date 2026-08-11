/**
 * Unit tier — the two-level export position.
 *
 * The properties here are what stop an export from being quietly wrong: a
 * position that round-trips, a position that refuses to be guessed at, and a
 * step decision that keeps a chunk to one cursored read.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_CURSOR_LENGTH,
  START_POSITION,
  decodeExportPosition,
  encodeExportPosition,
  stepFor,
} from "./exportCursor";

const roundTrip = (position: Parameters<typeof encodeExportPosition>[0]) => {
  const encoded = encodeExportPosition(position);
  expect(encoded.ok).toBe(true);
  return decodeExportPosition(encoded.ok ? encoded.value : "");
};

describe("encoding a position", () => {
  it("round-trips the start of a walk", () => {
    expect(roundTrip(START_POSITION)).toEqual({ ok: true, value: {} });
  });

  it("round-trips a one-level position", () => {
    expect(roundTrip({ outer: "cursor-a" })).toEqual({
      ok: true,
      value: { outer: "cursor-a" },
    });
  });

  it("round-trips a two-level position", () => {
    expect(
      roundTrip({ outer: "cursor-a", subjectId: "rcpt_1", inner: "cursor-b" }),
    ).toEqual({
      ok: true,
      value: { outer: "cursor-a", subjectId: "rcpt_1", inner: "cursor-b" },
    });
  });

  it("omits absent fields rather than writing nulls", () => {
    // The "advance the parent next" state must be the visible *absence* of a
    // subject, not a sentinel whose meaning has to be remembered.
    const encoded = encodeExportPosition({ outer: "a" });
    expect(encoded.ok && encoded.value).toBe('{"outer":"a"}');
  });

  it("refuses a position too long to store", () => {
    /*
     * Found at encode time rather than at write time: discovering it after a
     * chunk had been rendered would lose the page of work that produced it.
     */
    const encoded = encodeExportPosition({
      outer: "x".repeat(MAX_CURSOR_LENGTH),
    });

    expect(encoded.ok).toBe(false);
    expect(encoded.ok ? undefined : encoded.error.code).toBe("CURSOR_TOO_LONG");
  });
});

describe("decoding a position", () => {
  it("treats an absent cursor as the start, not as an error", () => {
    expect(decodeExportPosition(undefined)).toEqual({ ok: true, value: {} });
    expect(decodeExportPosition("")).toEqual({ ok: true, value: {} });
  });

  it("refuses text that is not a position", () => {
    /*
     * Continuing from a position nobody can interpret would restart the walk and
     * duplicate every row already written — so an unreadable cursor is a failure
     * rather than a reset.
     */
    expect(decodeExportPosition("not json")).toEqual({
      ok: false,
      error: { code: "CURSOR_UNPARSEABLE" },
    });
    expect(decodeExportPosition("[1,2]")).toEqual({
      ok: false,
      error: { code: "CURSOR_MALFORMED" },
    });
    expect(decodeExportPosition('{"outer":7}')).toEqual({
      ok: false,
      error: { code: "CURSOR_MALFORMED" },
    });
  });

  it("refuses an inner cursor with no subject", () => {
    // "Halfway through a receipt" without saying which. Guessing means either
    // skipping one receipt's lines or exporting another's twice.
    expect(decodeExportPosition('{"inner":"c"}')).toEqual({
      ok: false,
      error: { code: "CURSOR_MALFORMED" },
    });
  });
});

describe("choosing the next step", () => {
  it("advances the parent when no subject is being drained", () => {
    expect(stepFor({})).toBe("ADVANCE_SUBJECT");
    expect(stepFor({ outer: "a" })).toBe("ADVANCE_SUBJECT");
  });

  it("drains the subject while one is held", () => {
    expect(stepFor({ subjectId: "rcpt_1" })).toBe("DRAIN_SUBJECT");
    expect(stepFor({ subjectId: "rcpt_1", inner: "c" })).toBe("DRAIN_SUBJECT");
  });
});
