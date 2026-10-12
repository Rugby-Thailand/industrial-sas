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
  const { view } = useFloorWorkspaceView();
  return (
    <>
      <output aria-label="Query">{query}</output>
      <output aria-label="Panel">{view}</output>
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
