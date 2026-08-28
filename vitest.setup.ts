import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";
import { afterEach, expect, vi } from "vitest";
import type * as ConvexReact from "convex/react";

vi.mock("convex/react", async (importOriginal) => {
  const actual = await importOriginal<typeof ConvexReact>();
  const { getFunctionName } = await import("convex/server");
  const { resolveTestQuery } = await import("./tests/fixtures/convex-query");

  return {
    ...actual,
    useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
    useMutation: () => async () => ({
      ok: true,
      requestId: "test_request",
      value: { written: true, documentId: "test_document", replayed: false },
    }),
    useQuery: (
      reference: Parameters<typeof getFunctionName>[0],
      args: Record<string, unknown> | "skip" = {},
    ) =>
      args === "skip"
        ? undefined
        : resolveTestQuery(getFunctionName(reference), args),
    useQuery_experimental: ({
      query,
      args,
    }: {
      query: Parameters<typeof getFunctionName>[0];
      args: Record<string, unknown> | "skip";
    }) => {
      if (args === "skip") return { status: "pending" as const };
      try {
        const data = resolveTestQuery(getFunctionName(query), args);
        return data === undefined
          ? { status: "pending" as const }
          : { status: "success" as const, data };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error : new Error("Query failed"),
        };
      }
    },
  };
});

expect.extend(toHaveNoViolations);

/**
 * Testing Library only auto-registers its cleanup when `afterEach` is a global.
 * This project keeps `globals: false` and imports test APIs explicitly, so the
 * unmount has to be wired up by hand — otherwise renders accumulate in the same
 * document and queries fail with "found multiple elements".
 */
afterEach(() => {
  cleanup();
});

/*
 * The browser APIs jsdom does not implement and Radix's portalled menus call.
 *
 * These are stubs, not simulations. A Radix Select measures its trigger, keeps
 * the highlighted row in view, and takes pointer capture so a press-drag-release
 * selects in one gesture. jsdom computes no layout, so each of those calls lands
 * on a method that does not exist and throws — the component is fine, the
 * environment is missing a surface.
 *
 * They are declared once here rather than per test file because the alternative
 * is every future test that opens a menu rediscovering the same three failures.
 * Nothing below is asserted on: geometry is checked by the Playwright screenshot
 * suite, in a browser that has it.
 */
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
}

/*
 * jsdom ships no `matchMedia`, and the shell asks it one question: is the
 * viewport below the navigation-rail breakpoint. Answering "no" puts every
 * component test on the wide layout, which is the one a desktop-shell test is
 * about — and, more usefully, means the navigation tree renders in flow where a
 * test can query it without opening a sheet first. The narrow layout is covered
 * where it can be covered honestly: Playwright, at a real 360-pixel viewport.
 */
if (typeof window !== "undefined" && window.matchMedia === undefined) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
