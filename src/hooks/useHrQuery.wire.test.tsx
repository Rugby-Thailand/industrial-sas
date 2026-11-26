import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useHrQuery } from "./useHrQuery";

vi.unmock("convex/react");

type Operation =
  | { type: "Add"; queryId: number; udfPath: string; args: object[] }
  | { type: "Remove"; queryId: number };

class QuerySocket {
  static connection: QuerySocket;
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (message: { data: string }) => void;
  operations: Operation[] = [];
  private requestedVersion = 0;
  private appliedVersion = { querySet: 0, identity: 0, ts: "AAAAAAAAAAA=" };

  constructor() {
    QuerySocket.connection = this;
  }

  send(data: string) {
    const message = JSON.parse(data);
    if (message.type === "ModifyQuerySet") {
      this.operations.push(...message.modifications);
      this.requestedVersion = message.newVersion;
    }
  }

  close() {
    this.onclose?.();
  }

  respond(
    operations: Operation[],
    value: string,
    querySet = this.requestedVersion,
  ) {
    const endVersion = { ...this.appliedVersion, querySet };
    this.onmessage?.({
      data: JSON.stringify({
        type: "Transition",
        startVersion: this.appliedVersion,
        endVersion,
        modifications: operations.map((operation) =>
          operation.type === "Add"
            ? {
                type: "QueryUpdated",
                queryId: operation.queryId,
                value,
                logLines: [],
                journal: null,
              }
            : { type: "QueryRemoved", queryId: operation.queryId },
        ),
      }),
    });
    this.appliedVersion = endVersion;
  }

  get version() {
    return this.requestedVersion;
  }

  ping() {
    this.onmessage?.({ data: JSON.stringify({ type: "Ping" }) });
  }
}

const today = makeFunctionReference<"query", { clockRefresh?: number }, string>(
  "hr/self:today",
);
const holidays = makeFunctionReference<
  "query",
  { year: number; clockRefresh?: number },
  string
>("hr/self:holidays");

function TodayReads() {
  const date = useHrQuery(today, {});
  const thisYear = useHrQuery(holidays, { year: 2026 });
  const nextYear = useHrQuery(holidays, { year: 2027 });
  if (date === undefined || thisYear === undefined || nextYear === undefined)
    return <>Loading</>;
  return <Draft date={date} />;
}

function Draft({ date }: { date: string }) {
  const [draft, setDraft] = useState("");
  return (
    <>
      <output>{date}</output>
      <input
        aria-label="Correction"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </>
  );
}

let client: ConvexReactClient;
function connect() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T16:59:30Z"));
  client = new ConvexReactClient("https://hr-test.convex.cloud", {
    webSocketConstructor: QuerySocket as unknown as typeof WebSocket,
    unsavedChangesWarning: false,
  });
  render(
    <ConvexProvider client={client}>
      <TodayReads />
    </ConvexProvider>,
  );
  const socket = QuerySocket.connection;
  act(() => socket.onopen?.());
  act(() => socket.respond(socket.operations.splice(0), "October 13"));
  // The mount refresh can subscribe to the current clock alongside the initial read.
  act(() => socket.respond(socket.operations.splice(0), "October 13"));
  expect(screen.getByText("October 13")).toBeInTheDocument();
  expect(socket.operations).toHaveLength(0);
  return socket;
}

afterEach(async () => {
  cleanup();
  await client?.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("sends three replacements for one foreground return and keeps them through the first replies", () => {
  const socket = connect();
  const input = screen.getByRole("textbox", { name: "Correction" });
  fireEvent.change(input, { target: { value: "Unsubmitted correction" } });
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  vi.setSystemTime(new Date("2026-10-13T17:00:00Z"));
  expect(socket.operations).toHaveLength(0);

  visibility.mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  const replacements = [...socket.operations];
  const version = socket.version;
  expect(replacements.map(({ type }) => type)).toEqual(["Add", "Add", "Add"]);
  expect(replacements).toEqual([
    expect.objectContaining({ udfPath: "hr/self:today" }),
    expect.objectContaining({
      udfPath: "hr/self:holidays",
      args: [expect.objectContaining({ year: 2026 })],
    }),
    expect.objectContaining({
      udfPath: "hr/self:holidays",
      args: [expect.objectContaining({ year: 2027 })],
    }),
  ]);
  act(() => vi.advanceTimersByTime(150));
  act(() => window.dispatchEvent(new Event("focus")));

  expect(socket.operations.map(({ type }) => type)).toEqual([
    "Add",
    "Add",
    "Add",
  ]);
  expect(screen.getByText("October 13")).toBeInTheDocument();
  expect(input).toHaveValue("Unsubmitted correction");
  socket.operations.length = 0;
  act(() => socket.respond(replacements, "October 14", version));
  expect(screen.getByText("October 14")).toBeInTheDocument();
  expect(screen.getByRole("textbox")).toBe(input);
  expect(input).toHaveValue("Unsubmitted correction");
  expect(socket.operations.map(({ type }) => type)).toEqual([
    "Remove",
    "Remove",
    "Remove",
  ]);
});

it("refreshes on focus after a long hidden period and retries a stalled refresh on a visible tick", () => {
  const socket = connect();
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("hidden");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  // Keep the transport healthy so only the query response stalls.
  for (let i = 0; i < 9; i++) {
    act(() => vi.advanceTimersByTime(20_000));
    act(() => socket.ping());
  }
  expect(socket.operations).toHaveLength(0);

  visibility.mockReturnValue("visible");
  act(() => window.dispatchEvent(new Event("focus")));
  const stalled = socket.operations.splice(0);
  expect(stalled.map(({ type }) => type)).toEqual(["Add", "Add", "Add"]);
  for (let i = 0; i < 2; i++) {
    act(() => vi.advanceTimersByTime(20_000));
    act(() => socket.ping());
  }
  act(() => vi.advanceTimersByTime(19_999));
  expect(socket.operations).toHaveLength(0);
  expect(screen.getByText("October 13")).toBeInTheDocument();

  act(() => vi.advanceTimersByTime(1));
  const retry = socket.operations.splice(0);
  expect(
    retry.filter(({ type }) => type === "Remove").map(({ queryId }) => queryId),
  ).toEqual(stalled.map(({ queryId }) => queryId));
  expect(retry.filter(({ type }) => type === "Add")).toHaveLength(3);
  act(() => socket.respond(retry, "October 14"));
  expect(screen.getByText("October 14")).toBeInTheDocument();
});
