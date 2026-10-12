import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import { useWorkspaceQuery } from "@/features/storageLayouts/useWorkspaceQuery";
import { useFloorWorkspaceView } from "@/components/storageLayouts/useFloorWorkspaceView";
import { GUARD_HISTORY_KEY, trackAppHistory } from "@/lib/browser/appHistory";
import { isGuardTraversal } from "@/lib/navigationGuard";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

let stopTracking: (() => void) | undefined;
beforeEach(() => {
  history.replaceState(
    { __NA: true, appNavigationIndex: 0 },
    "",
    "/planner?panel=map&floor=1#map",
  );
  stopTracking = trackAppHistory();
  history.pushState({ __NA: true }, "", "/planner?panel=list&floor=2#map");
});
afterEach(() => stopTracking?.());

function Workspace() {
  const [draft, setDraft] = useState("unsaved");
  const control = useNavigationDraft({
    dirty: draft !== "",
    pending: false,
    discard: () => setDraft(""),
  });
  const query = useWorkspaceQuery();
  const { view, setView } = useFloorWorkspaceView();
  return (
    <>
      <output aria-label="Query">{query}</output>
      <output aria-label="Panel">{view}</output>
      <button onClick={() => setView("map")}>Show map</button>
      <input
        aria-label="Draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        onClick={() => {
          setDraft("");
          control.settle(() => history.back());
        }}
      >
        Save and Back
      </button>
    </>
  );
}

it("keeps both query readers committed through a real draft Back restoration and discard", async () => {
  render(
    <NavigationGuardProvider>
      <Workspace />
    </NavigationGuardProvider>,
  );
  expect(history.state[GUARD_HISTORY_KEY]).toBeDefined();
  act(() => history.back());
  await screen.findByRole("dialog");
  await waitFor(() => expect(history.state[GUARD_HISTORY_KEY]).toBeDefined());
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?panel=list&floor=2",
  );
  expect(screen.getByLabelText("Panel")).toHaveTextContent("list");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("unsaved");
  act(() => history.back());
  fireEvent.click(
    await screen.findByRole("button", { name: "Discard changes" }),
  );
  await waitFor(() => expect(location.search).toBe("?panel=map&floor=1"));
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?panel=map&floor=1",
  );
  expect(screen.getByLabelText("Panel")).toHaveTextContent("map");
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("");
});

it("publishes buffer cleanup before the settled completion performs the real Back", async () => {
  render(
    <NavigationGuardProvider>
      <Workspace />
    </NavigationGuardProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save and Back" }));
  await waitFor(() => expect(location.search).toBe("?panel=map&floor=1"));
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?panel=map&floor=1",
  );
  expect(screen.getByLabelText("Panel")).toHaveTextContent("map");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("returns to the previous committed query after discarding a multi-entry Back", async () => {
  render(
    <NavigationGuardProvider>
      <Workspace />
    </NavigationGuardProvider>,
  );
  // The browser's history menu can jump past both the guard buffer and its
  // same-URL base entry. Restoration must reach the actual buffer before
  // Discard removes it and performs the permitted Back.
  act(() => history.go(-2));
  await screen.findByRole("dialog");
  await waitFor(() => expect(isGuardTraversal()).toBe(false));
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?panel=list&floor=2",
  );
  expect(screen.getByLabelText("Panel")).toHaveTextContent("list");
  expect(screen.getByLabelText("Draft")).toHaveValue("unsaved");
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(location.search).toBe("?panel=map&floor=1"));
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?panel=map&floor=1",
  );
  expect(screen.getByLabelText("Panel")).toHaveTextContent("map");
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("");
});

it("does not turn an orphaned same-page guard buffer into a new Back step on immediate provider remount", () => {
  const first = render(
    <NavigationGuardProvider>
      <Workspace />
    </NavigationGuardProvider>,
  );
  expect(history.state.appNavigationIndex).toBe(1);
  first.unmount();
  const second = render(
    <NavigationGuardProvider>
      <Workspace />
    </NavigationGuardProvider>,
  );
  expect(history.state.appNavigationIndex).toBe(1);
  second.unmount();
});

it("returns to the previous committed query after Back, Keep and Discard across an immediate owner remount", async () => {
  const first = render(
    <NavigationGuardProvider>
      <Workspace />
    </NavigationGuardProvider>,
  );
  first.unmount();
  render(
    <NavigationGuardProvider>
      <Workspace />
    </NavigationGuardProvider>,
  );
  act(() => history.back());
  await screen.findByRole("dialog");
  await waitFor(() => expect(isGuardTraversal()).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?panel=list&floor=2",
  );
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("unsaved");
  act(() => history.back());
  const discard = await screen.findByRole("button", {
    name: "Discard changes",
  });
  await waitFor(() => expect(isGuardTraversal()).toBe(false));
  fireEvent.click(discard);
  await waitFor(() => expect(location.search).toBe("?panel=map&floor=1"));
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?panel=map&floor=1",
  );
});

/** Readers only: a reload dropped the unsaved state, so nothing registers. */
function CleanWorkspace() {
  const query = useWorkspaceQuery();
  const { view } = useFloorWorkspaceView();
  return (
    <>
      <output aria-label="Query">{query}</output>
      <output aria-label="Panel">{view}</output>
    </>
  );
}

it("takes the first Back to the previous committed query after a clean reload left a guard marker", async () => {
  // A full reload keeps the old document's same-URL buffer entry but loses
  // React-only drafts (e.g. scanned tickets), so the new owner stays clean.
  const previousDocumentMarker = "6d61b80a-75d2-41bf-9be8-8f21c6bc58be";
  history.pushState(
    { ...history.state, [GUARD_HISTORY_KEY]: previousDocumentMarker },
    "",
    location.href,
  );
  const back = vi.spyOn(history, "back");
  render(
    <NavigationGuardProvider>
      <CleanWorkspace />
    </NavigationGuardProvider>,
  );
  // Mounting never traverses history.
  expect(back).not.toHaveBeenCalled();
  expect(location.search).toBe("?panel=list&floor=2");
  act(() => history.back());
  await waitFor(() => expect(location.search).toBe("?panel=map&floor=1"));
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?panel=map&floor=1",
  );
  expect(screen.getByLabelText("Panel")).toHaveTextContent("map");
  expect(isGuardTraversal()).toBe(false);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  back.mockRestore();
});

it("skips a clean reload buffer at app depth zero on the first Back to an unmanaged entry", async () => {
  // App depth excludes earlier documents; a cold app entry can be zero
  // while the browser still has a genuine previous entry.
  stopTracking?.();
  history.replaceState(null, "", "/outside-app?return=before-app");
  history.pushState(
    { __NA: true, appNavigationIndex: 0 },
    "",
    "/planner?panel=list&floor=2#map",
  );
  stopTracking = trackAppHistory();
  history.pushState(
    {
      ...history.state,
      [GUARD_HISTORY_KEY]: "7e70708b-3397-48a4-bac0-1ca0632d5c82",
    },
    "",
    location.href,
  );
  const back = vi.spyOn(history, "back");
  render(
    <NavigationGuardProvider>
      <CleanWorkspace />
    </NavigationGuardProvider>,
  );
  expect(history.state.appNavigationIndex).toBe(0);
  expect(back).not.toHaveBeenCalled();
  act(() => history.back());
  await waitFor(() => expect(location.pathname).toBe("/outside-app"));
  expect(location.search).toBe("?return=before-app");
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?return=before-app",
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  back.mockRestore();
});

it("takes the first Back past a clean reload buffer whose view setter replaced its query", async () => {
  const first = render(
    <NavigationGuardProvider>
      <Workspace />
    </NavigationGuardProvider>,
  );
  // The real presentation setter replaces the buffer entry's query only.
  fireEvent.click(screen.getByRole("button", { name: "Show map" }));
  expect(location.search).toBe("?floor=2");
  expect(history.state.appNavigationIndex).toBe(1);
  expect(history.state[GUARD_HISTORY_KEY]).toBeDefined();
  // A reload drops the React-only draft while keeping the current entry.
  first.unmount();
  const back = vi.spyOn(history, "back");
  render(
    <NavigationGuardProvider>
      <CleanWorkspace />
    </NavigationGuardProvider>,
  );
  expect(back).not.toHaveBeenCalled();
  act(() => history.back());
  await waitFor(() => expect(location.search).toBe("?panel=map&floor=1"));
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?panel=map&floor=1",
  );
  expect(screen.getByLabelText("Panel")).toHaveTextContent("map");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  back.mockRestore();
});

it("returns to the previous committed query after a guard marker survives a full document reload", async () => {
  // A reload retains this same-URL buffer in browser history, while the new
  // document's in-memory ownership set contains none of the old marker IDs.
  const previousDocumentMarker = "c20e4331-d2f4-41cc-9595-aedb5d8a9a67";
  history.pushState(
    { ...history.state, [GUARD_HISTORY_KEY]: previousDocumentMarker },
    "",
    location.href,
  );
  render(
    <NavigationGuardProvider>
      <Workspace />
    </NavigationGuardProvider>,
  );
  act(() => history.back());
  await screen.findByRole("dialog");
  await waitFor(() => expect(isGuardTraversal()).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?panel=list&floor=2",
  );
  expect(screen.getByLabelText("Panel")).toHaveTextContent("list");
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("unsaved");
  act(() => history.back());
  const discard = await screen.findByRole("button", {
    name: "Discard changes",
  });
  await waitFor(() => expect(isGuardTraversal()).toBe(false));
  fireEvent.click(discard);
  await waitFor(() => expect(location.search).toBe("?panel=map&floor=1"));
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?panel=map&floor=1",
  );
  expect(screen.getByLabelText("Panel")).toHaveTextContent("map");
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("");
});

it("preserves the earlier page selected from the browser history menu after Discard", async () => {
  // The committed pages are floor 1, floor 2, then floor 3. Selecting floor 1
  // from the browser menu jumps past two distinct pages and the guard buffer.
  history.pushState({ __NA: true }, "", "/planner?panel=map&floor=3#map");
  render(
    <NavigationGuardProvider>
      <Workspace />
    </NavigationGuardProvider>,
  );
  act(() => history.go(-3));
  await screen.findByRole("dialog");
  await waitFor(() => expect(isGuardTraversal()).toBe(false));
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?panel=map&floor=3",
  );
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(location.search).toBe("?panel=map&floor=1"));
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?panel=map&floor=1",
  );
  expect(screen.getByLabelText("Panel")).toHaveTextContent("map");
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("");
});

it("restores the guard entry on Keep editing and reaches the same browser-menu target again", async () => {
  history.pushState({ __NA: true }, "", "/planner?panel=map&floor=3#map");
  render(
    <NavigationGuardProvider>
      <Workspace />
    </NavigationGuardProvider>,
  );
  const buffer = history.state[GUARD_HISTORY_KEY];
  act(() => history.go(-3));
  await screen.findByRole("dialog");
  await waitFor(() => expect(isGuardTraversal()).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  // Cancelling restores the guard entry itself (the newest entry), not the
  // unmarked page below it, so a later Forward has no guard entry to reach.
  expect(history.state[GUARD_HISTORY_KEY]).toBe(buffer);
  expect(location.search).toBe("?panel=map&floor=3");
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("unsaved");

  // The same menu choice reaches the same earlier page after Discard.
  act(() => history.go(-3));
  const discard = await screen.findByRole("button", {
    name: "Discard changes",
  });
  await waitFor(() => expect(isGuardTraversal()).toBe(false));
  fireEvent.click(discard);
  await waitFor(() => expect(location.search).toBe("?panel=map&floor=1"));
  expect(screen.getByLabelText("Query")).toHaveTextContent(
    "?panel=map&floor=1",
  );
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("");
});
