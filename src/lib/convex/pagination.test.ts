import { describe, expect, it } from "vitest";

import {
  advance,
  currentCursor,
  initialCursorState,
  isFirstPage,
  pageNumber,
  reset,
  retreat,
} from "./pagination";

describe("cursor paging", () => {
  it("starts on the first page with no cursor", () => {
    expect(currentCursor(initialCursorState)).toBeUndefined();
    expect(isFirstPage(initialCursorState)).toBe(true);
    expect(pageNumber(initialCursorState)).toBe(1);
  });

  it("advances to the cursor the server supplied", () => {
    const second = advance(initialCursorState, "c2");

    expect(currentCursor(second)).toBe("c2");
    expect(pageNumber(second)).toBe(2);
    expect(isFirstPage(second)).toBe(false);
  });

  it("ignores an advance past the end", () => {
    const state = advance(initialCursorState, null);
    expect(state).toBe(initialCursorState);
  });

  it("retreats to the previous cursor", () => {
    const third = advance(advance(initialCursorState, "c2"), "c3");

    expect(currentCursor(retreat(third))).toBe("c2");
    expect(currentCursor(retreat(retreat(third)))).toBeUndefined();
  });

  it("cannot retreat past the first page", () => {
    expect(retreat(initialCursorState)).toBe(initialCursorState);
  });

  it("returns to the first page on reset", () => {
    expect(reset()).toEqual(initialCursorState);
  });

  it("never mutates the state it is handed", () => {
    const first = advance(initialCursorState, "c2");
    advance(first, "c3");
    retreat(first);

    expect(first.stack).toEqual(["c2"]);
    expect(Object.isFrozen(first.stack)).toBe(true);
  });
});
