import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { useFloorWorkspaceView } from "@/components/storageLayouts/useFloorWorkspaceView";
import { GUARD_HISTORY_KEY, trackAppHistory } from "@/lib/browser/appHistory";
import { updateBrowserQuery } from "@/lib/browser/history";
import { isGuardTraversal } from "@/lib/navigationGuard";

import {
  NavigationGuardProvider,
  useNavigationDraft,
} from "./NavigationGuardProvider";

const PREVIOUS = "/en/finished-goods?category=stock#catalogue";
const FLOOR =
  "/en/master-data/storage-layouts/building/floors/2?floor=2&view=storage&editing=1#map";
let stopTracking: () => void;
let stopObservers: Array<() => void>;

const currentPage = () =>
  window.location.pathname + window.location.search + window.location.hash;

function observeCommittedTraversals() {
  const pages: string[] = [];
  const onPop = () => pages.push(currentPage());
  window.addEventListener("popstate", onPop);
  stopObservers.push(() => window.removeEventListener("popstate", onPop));
  return pages;
}

function FloorWorkspace({
  initialDirty = false,
  pending = false,
}: {
  initialDirty?: boolean;
  pending?: boolean;
}) {
  const [draft, setDraft] = useState(initialDirty ? "Draft area" : "");
  useNavigationDraft({
    dirty: draft !== "",
    pending,
    discard: () => setDraft(""),
  });
  const { view, setView } = useFloorWorkspaceView();
  return (
    <>
      <input
        aria-label="Area name"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <output aria-label="Floor view">{view}</output>
      <button onClick={() => setView("list")}>Show list</button>
      <button onClick={() => setView("map")}>Show map</button>
    </>
  );
}

const workspace = (dirty = false, pending = false) => (
  <StrictMode>
    <NavigationGuardProvider>
      <FloorWorkspace initialDirty={dirty} pending={pending} />
    </NavigationGuardProvider>
  </StrictMode>
);

function SettlingEditor() {
  const guard = useNavigationDraft({
    dirty: true,
    pending: false,
    discard: () => {},
  });
  return <button onClick={() => guard.settle()}>Settle area</button>;
}

beforeEach(() => {
  stopObservers = [];
  window.history.replaceState(
    {
      __NA: true,
      appNavigationIndex: 0,
      __PRIVATE_NEXTJS_INTERNALS_TREE: { route: "stock" },
    },
    "",
    PREVIOUS,
  );
  stopTracking = trackAppHistory();
  window.history.pushState(
    {
      __NA: true,
      __PRIVATE_NEXTJS_INTERNALS_TREE: { route: "floor" },
      catalogueSession: "floor-session",
    },
    "",
    FLOOR,
  );
});

afterEach(() => {
  cleanup();
  for (const stop of stopObservers) stop();
  stopTracking();
  vi.restoreAllMocks();
});

describe("Floor presentation changes across an owner remount", () => {
  // jsdom preserves the real history stack across this shell remount. An actual
  // document reload is covered by the separate native-browser integration run.
  it.each(["before", "after"])(
    "one Back reaches the previous page when Map/List changes %s the clean remount",
    async (when) => {
      const dirty = render(workspace(true));
      if (when === "before")
        fireEvent.click(screen.getByRole("button", { name: "Show list" }));
      dirty.unmount();
      render(workspace());
      if (when === "after")
        fireEvent.click(screen.getByRole("button", { name: "Show list" }));

      expect(screen.getByLabelText("Floor view")).toHaveTextContent("list");
      expect(window.location.search).toBe(
        "?floor=2&view=storage&editing=1&panel=list",
      );
      expect(window.location.hash).toBe("#map");
      expect(window.history.state).toMatchObject({
        __PRIVATE_NEXTJS_INTERNALS_TREE: { route: "floor" },
        catalogueSession: "floor-session",
      });

      const committed = observeCommittedTraversals();
      act(() => window.history.back());
      await waitFor(() => expect(committed).toEqual([PREVIOUS]));
      expect(currentPage()).toBe(PREVIOUS);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it.each(["removed", "replaced"])(
    "exposes the real Back entry when a replacement write has %s the inherited marker",
    async (change) => {
      const dirty = render(workspace(true));
      dirty.unmount();
      render(workspace());
      const state = { ...window.history.state };
      if (change === "removed") delete state[GUARD_HISTORY_KEY];
      else state[GUARD_HISTORY_KEY] = "another-owner";
      act(() =>
        window.history.replaceState(
          state,
          "",
          FLOOR.replace("#map", "&panel=list#map"),
        ),
      );

      const committed = observeCommittedTraversals();
      act(() => window.history.back());
      await waitFor(() => expect(committed).toEqual([FLOOR]));
      expect(currentPage()).toBe(FLOOR);
    },
  );

  it("exposes the real Back entry after a replacement leaves the floor route", async () => {
    const dirty = render(workspace(true));
    dirty.unmount();
    render(workspace());
    act(() =>
      window.history.replaceState(
        { ...window.history.state, __NA: true },
        "",
        "/en/hr/today",
      ),
    );

    const committed = observeCommittedTraversals();
    act(() => window.history.back());
    await waitFor(() => expect(committed).toEqual([FLOOR]));
    expect(currentPage()).toBe(FLOOR);
  });

  it("does not swallow the next real Back after a route write overtakes settlement", async () => {
    render(
      <NavigationGuardProvider>
        <SettlingEditor />
      </NavigationGuardProvider>,
    );
    const committed = observeCommittedTraversals();
    act(() => {
      screen.getByRole("button", { name: "Settle area" }).click();
      window.history.pushState({ __NA: true }, "", "/en/hr/today");
    });
    expect(currentPage()).toBe("/en/hr/today");
    expect(isGuardTraversal()).toBe(false);
    // The push supersedes the scheduled removal; the user's next real Back
    // still has to reach normal listeners rather than finish stale removal.
    act(() => window.history.back());
    await waitFor(() => expect(committed).toEqual([FLOOR]));
    expect(currentPage()).toBe(FLOOR);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("restores a newly dirty pushed query, retains its draft, then discards to the preceding committed view", async () => {
    const first = render(workspace(true));
    first.unmount();
    render(workspace());
    act(() =>
      updateBrowserQuery((query) => query.set("panel", "list"), {
        mode: "push",
      }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Area name" }), {
      target: { value: "Second area draft" },
    });
    const committed = observeCommittedTraversals();
    act(() => window.history.back());
    await screen.findByRole("dialog");
    await waitFor(() => expect(isGuardTraversal()).toBe(false));
    expect(screen.getByLabelText("Area name")).toHaveValue("Second area draft");
    expect(screen.getByLabelText("Floor view")).toHaveTextContent("list");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Area name" })).toHaveValue(
      "Second area draft",
    );

    act(() => window.history.back());
    await screen.findByRole("dialog");
    await waitFor(() => expect(isGuardTraversal()).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(committed).toEqual([FLOOR]));
    expect(currentPage()).toBe(FLOOR);
    expect(screen.getByRole("textbox", { name: "Area name" })).toHaveValue("");
    expect(screen.getByLabelText("Floor view")).toHaveTextContent("map");
  });

  it.each([
    { state: "dirty", dirty: true, pending: false, draft: "Draft area" },
    { state: "pending-only", dirty: false, pending: true, draft: "" },
  ])(
    "keeps $state work protected when a query is pushed during its registration",
    async ({ dirty, pending, draft }) => {
      render(workspace(dirty, pending));
      act(() =>
        updateBrowserQuery((query) => query.set("panel", "list"), {
          mode: "push",
        }),
      );
      const committed = observeCommittedTraversals();
      act(() => window.history.back());
      await screen.findByRole("dialog");
      await waitFor(() => expect(isGuardTraversal()).toBe(false));
      expect(currentPage()).toBe(FLOOR.replace("#map", "&panel=list#map"));
      expect(committed).toEqual([]);
      expect(screen.getByLabelText("Area name")).toHaveValue(draft);
      if (pending) {
        expect(screen.getByTestId("navigation-guard-pending")).toBeVisible();
        expect(
          screen.getByRole("button", { name: "Discard changes" }),
        ).toBeDisabled();
      }
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Area name")).toHaveValue(draft);
      expect(screen.getByLabelText("Floor view")).toHaveTextContent("list");
    },
  );
});
