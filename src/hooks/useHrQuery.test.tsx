import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { makeFunctionReference } from "convex/server";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) =>
    args === "skip" ? undefined : transport.read(args),
}));

import { useHrQuery } from "./useHrQuery";

const query = makeFunctionReference<
  "query",
  { record: string; clockRefresh?: number },
  { status: string }
>("hr/example:read");

function Draft({ status }: { status: string }) {
  const [draft, setDraft] = useState("");
  return (
    <>
      <output>{status}</output>
      <input
        aria-label="Draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </>
  );
}
function Screen({
  record = "a",
  skip = false,
}: {
  record?: string;
  skip?: boolean;
}) {
  const value = useHrQuery(query, skip ? "skip" : { record });
  return value === undefined ? <p>Loading</p> : <Draft status={value.status} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T16:59:30.000Z"));
  transport.read.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("refreshes at midnight without a database write and preserves a dirty child during delayed responses", () => {
  const boundary = Date.parse("2026-10-13T17:00:00.000Z");
  let available = false;
  transport.read.mockImplementation(
    ({ clockRefresh }: { clockRefresh: number }) =>
      clockRefresh < boundary
        ? { status: "October 13" }
        : available
          ? { status: "October 14" }
          : undefined,
  );
  const view = render(<Screen />);
  fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), {
    target: { value: "Unsubmitted correction" },
  });
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByText("October 13")).toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveValue("Unsubmitted correction");
  available = true;
  view.rerender(<Screen />);
  expect(screen.getByText("October 14")).toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveValue("Unsubmitted correction");
});

it("keeps the old subscription reactive while the replacement loads, including permission revocation", () => {
  let waiting = false;
  let frozen = 0;
  let revoked = false;
  transport.read.mockImplementation(
    ({ clockRefresh }: { clockRefresh: number }) => {
      // Initial mount may immediately refresh; accept every pre-boundary token.
      return !waiting || clockRefresh <= frozen
        ? { status: revoked ? "Denied" : "Allowed" }
        : undefined;
    },
  );
  const view = render(<Screen />);
  frozen = Math.max(
    ...transport.read.mock.calls.map(([args]) => args.clockRefresh),
  );
  waiting = true;
  act(() => vi.advanceTimersByTime(60_000));
  revoked = true;
  view.rerender(<Screen />);
  expect(screen.getByText("Denied")).toBeInTheDocument();
  expect(screen.queryByText("Allowed")).not.toBeInTheDocument();
});

it("does not show the previous record or authenticated result when arguments change or queries skip", () => {
  transport.read.mockImplementation(({ record }: { record: string }) =>
    record === "a" ? { status: "Employee A" } : undefined,
  );
  const view = render(<Screen />);
  expect(screen.getByText("Employee A")).toBeInTheDocument();
  view.rerender(<Screen record="b" />);
  expect(screen.getByText("Loading")).toBeInTheDocument();
  expect(screen.queryByText("Employee A")).not.toBeInTheDocument();
  view.rerender(<Screen skip />);
  expect(screen.getByText("Loading")).toBeInTheDocument();
});

it("pauses hidden-page refresh, resumes on focus/visibility, and releases the timer after the last consumer", () => {
  transport.read.mockReturnValue({ status: "Live" });
  const visibility = vi.spyOn(document, "visibilityState", "get");
  const view = render(
    <>
      <Screen />
      <Screen record="b" />
    </>,
  );
  expect(vi.getTimerCount()).toBe(1);
  transport.read.mockClear();
  visibility.mockReturnValue("hidden");
  act(() => vi.advanceTimersByTime(120_000));
  expect(transport.read).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(transport.read).toHaveBeenCalled();
  transport.read.mockClear();
  act(() => window.dispatchEvent(new Event("focus")));
  expect(transport.read).toHaveBeenCalled();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  transport.read.mockClear();
  act(() => window.dispatchEvent(new Event("focus")));
  expect(transport.read).not.toHaveBeenCalled();
});

it("clock-free consumers keep one subscription with unchanged arguments and allocate no refresh timer", () => {
  transport.read.mockReturnValue({ status: "Frozen" });
  function Frozen() {
    const value = useHrQuery(query, { record: "frozen" }, false);
    return <output>{value?.status}</output>;
  }
  render(<Frozen />);
  expect(screen.getByText("Frozen")).toBeInTheDocument();
  expect(transport.read).toHaveBeenCalledTimes(1);
  expect(transport.read).toHaveBeenCalledWith({ record: "frozen" });
  expect(vi.getTimerCount()).toBe(0);
  transport.read.mockClear();
  act(() => {
    vi.advanceTimersByTime(120_000);
    window.dispatchEvent(new Event("focus"));
  });
  expect(transport.read).not.toHaveBeenCalled();
});
