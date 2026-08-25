import { describe, expect, it } from "vitest";

import {
  DEFAULT_JOB_PAGE_SIZE,
  MAX_JOB_CURSOR_LENGTH,
  MAX_JOB_PAGE_SIZE,
  makeJobPage,
  makeJobPageRequest,
  nextJobPageRequest,
} from "./jobPage";

const request = (
  input: { maxPageSize?: number; cursor?: string | null } = {},
) => {
  const built = makeJobPageRequest(input);
  if (!built.ok) throw new Error(`expected a request: ${built.error.code}`);
  return built.value;
};

describe("page requests", () => {
  it("defaults conservatively and starts at the beginning", () => {
    expect(request()).toEqual({
      maxPageSize: DEFAULT_JOB_PAGE_SIZE,
      cursor: null,
    });
    expect(Object.isFrozen(request())).toBe(true);
  });

  it("rejects a size above the cap rather than clamping it", () => {
    const refused = makeJobPageRequest({ maxPageSize: MAX_JOB_PAGE_SIZE + 1 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("PAGE_SIZE_TOO_LARGE");
      expect(refused.error).toMatchObject({
        requested: MAX_JOB_PAGE_SIZE + 1,
        limit: MAX_JOB_PAGE_SIZE,
      });
    }
    expect(makeJobPageRequest({ maxPageSize: MAX_JOB_PAGE_SIZE }).ok).toBe(
      true,
    );
  });

  it("rejects a size a job could never terminate on", () => {
    for (const forged of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const refused = makeJobPageRequest({ maxPageSize: forged });
      expect(refused.ok, String(forged)).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("PAGE_SIZE_INVALID");
    }
  });

  it("validates the cursor it will never parse", () => {
    expect(request({ cursor: null }).cursor).toBeNull();
    expect(request({ cursor: undefined } as never).cursor).toBeNull();
    expect(request({ cursor: "abc" }).cursor).toBe("abc");

    const empty = makeJobPageRequest({ cursor: "" });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe("CURSOR_INVALID");

    const long = makeJobPageRequest({
      cursor: "x".repeat(MAX_JOB_CURSOR_LENGTH + 1),
    });
    expect(long.ok).toBe(false);
    if (!long.ok) {
      expect(long.error.code).toBe("CURSOR_TOO_LONG");
      expect(long.error).toMatchObject({ limit: MAX_JOB_CURSOR_LENGTH });
    }
  });

  it("rejects a forged request object", () => {
    const refused = makeJobPageRequest(null as never);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("NOT_A_JOB_PAGE_REQUEST");
    }
  });
});

describe("pages", () => {
  it("carries the items, the cursor, and the size that was asked for", () => {
    const page = makeJobPage(request({ maxPageSize: 2 }), ["a", "b"], {
      isDone: false,
      cursor: "next",
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value).toEqual({
      items: ["a", "b"],
      nextCursor: "next",
      complete: false,
      requestedPageSize: 2,
    });
    expect(Object.isFrozen(page.value)).toBe(true);
    expect(Object.isFrozen(page.value.items)).toBe(true);
  });

  it("copies the items, so a caller cannot widen a page it was handed", () => {
    const source = ["a"];
    const page = makeJobPage(request({ maxPageSize: 2 }), source, {
      isDone: true,
    });
    if (!page.ok) throw new Error("expected a page");
    source.push("b");
    expect(page.value.items).toEqual(["a"]);
  });

  it("refuses more items than were asked for", () => {
    const refused = makeJobPage(request({ maxPageSize: 1 }), ["a", "b"], {
      isDone: true,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("PAGE_OVERFLOW");
      expect(refused.error).toMatchObject({ returned: 2, requested: 1 });
    }
  });

  it("enforces the biconditional between completion and the cursor", () => {
    const both = makeJobPage(request(), [], { isDone: true, cursor: "next" });
    expect(both.ok).toBe(false);
    if (!both.ok) {
      expect(both.error.code).toBe("CURSOR_PRESENT_ON_COMPLETE_PAGE");
    }

    const neither = makeJobPage(request(), [], { isDone: false });
    expect(neither.ok).toBe(false);
    if (!neither.ok) {
      expect(neither.error.code).toBe("CURSOR_MISSING_FOR_CONTINUATION");
    }
  });

  it("treats a full final page as complete, not as one more page", () => {
    const page = makeJobPage(request({ maxPageSize: 2 }), ["a", "b"], {
      isDone: true,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.complete).toBe(true);
    expect(page.value.nextCursor).toBeNull();
    expect(page.value.items).toHaveLength(page.value.requestedPageSize);
  });

  it("treats an empty continuing page as continuing, not as complete", () => {
    const page = makeJobPage(request({ maxPageSize: 2 }), [], {
      isDone: false,
      cursor: "next",
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.complete).toBe(false);
  });

  it("refuses a forged continuation", () => {
    const refused = makeJobPage(request(), [], null as never);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("NOT_A_JOB_PAGE_REQUEST");
    }
  });
});

describe("resuming", () => {
  it("answers null once the job is complete", () => {
    const page = makeJobPage(request(), ["a"], { isDone: true });
    if (!page.ok) throw new Error("expected a page");
    expect(nextJobPageRequest(page.value)).toEqual({ ok: true, value: null });
  });

  it("carries the page size forward so a job does not resize halfway", () => {
    const page = makeJobPage(request({ maxPageSize: 7 }), ["a"], {
      isDone: false,
      cursor: "next",
    });
    if (!page.ok) throw new Error("expected a page");
    const next = nextJobPageRequest(page.value);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.value).toEqual({ maxPageSize: 7, cursor: "next" });
  });

  it("drives a whole job deterministically to completion", () => {
    const rows = ["a", "b", "c", "d", "e"];
    const collected: string[] = [];
    let current = request({ maxPageSize: 2 });
    let guard = 0;

    for (;;) {
      guard += 1;
      if (guard > 10) throw new Error("job did not terminate");
      const start = collected.length;
      const slice = rows.slice(start, start + current.maxPageSize);
      const done = start + slice.length >= rows.length;
      const page = makeJobPage(current, slice, {
        isDone: done,
        ...(done ? {} : { cursor: `after:${start + slice.length}` }),
      });
      if (!page.ok) throw new Error("expected a page");
      collected.push(...page.value.items);
      const next = nextJobPageRequest(page.value);
      if (!next.ok) throw new Error("expected a continuation decision");
      if (next.value === null) break;
      current = next.value;
    }

    expect(collected).toEqual(rows);
    expect(guard).toBe(3);
  });

  it("refuses to resume a page whose cursor was tampered away", () => {
    const refused = nextJobPageRequest({
      items: [],
      nextCursor: null,
      complete: false,
      requestedPageSize: 2,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("CURSOR_MISSING_FOR_CONTINUATION");
    }
  });
});
