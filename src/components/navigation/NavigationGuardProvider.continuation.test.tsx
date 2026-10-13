import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Activity, useLayoutEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import {
  NavigationGuardProvider,
  useNavigationDraft,
} from "@/components/navigation/NavigationGuardProvider";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { updateBrowserQuery } from "@/lib/browser/history";
import { guardedNavigate, isGuardTraversal } from "@/lib/navigationGuard";

const PREVIOUS = "/en/finished-goods";
const PAGE = "/en/master-data/storage-layouts/building";
const OTHER = "/en/hr/today";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type Draft = { text: string; dirty: boolean; pending: boolean };
const CLEAN: Draft = { text: "", dirty: false, pending: false };

type Controls = {
  editA: (text: string) => void;
  reportSavedA: () => void;
  cleanA: () => void;
  setB: (draft: Draft) => void;
};

let controls: Controls;
let completion: ReturnType<typeof deferred<boolean>>;
let stopTracking: () => void;
let queuedHistory: Array<() => void>;
let nativePopCount: number;
let countPop: () => void;
let popDelivered: (() => void) | undefined;
const leave = vi.fn();
const save = vi.fn<() => Promise<boolean>>();
const discardA = vi.fn();
const discardB = vi.fn();

function OtherDraft({ draft }: { draft: Draft }) {
  useNavigationDraft({
    dirty: draft.dirty,
    pending: draft.pending,
    discard: discardB,
  });
  return <input aria-label="Draft B" readOnly value={draft.text} />;
}

function Editor({ delayedDiscard = false }: { delayedDiscard?: boolean }) {
  const [a, setA] = useState<Draft>({
    text: "Floor draft",
    dirty: true,
    pending: false,
  });
  const [b, setB] = useState<Draft | null>(null);
  const latestA = useRef(a);
  useLayoutEffect(() => {
    latestA.current = a;
  });

  const guard = useNavigationDraft({
    dirty: a.dirty,
    pending: a.pending,
    save: async () => {
      const captured = latestA.current.text;
      setA((current) => ({ ...current, pending: true }));
      try {
        const saved = await save();
        if (saved)
          setA((current) =>
            current.text === captured ? CLEAN : { ...current, pending: false },
          );
        return saved;
      } finally {
        setA((current) => ({ ...current, pending: false }));
      }
    },
    discard: () => {
      discardA();
      // Disposed work is gone, even if its owner's clean report commits later.
      setA((current) => (delayedDiscard ? { ...current, text: "" } : CLEAN));
    },
  });
  useLayoutEffect(() => {
    controls = {
      editA: (text) => setA((current) => ({ ...current, text, dirty: true })),
      // Floor reports dirty=false in its current completion before pending ends.
      reportSavedA: () =>
        setA((current) => ({ ...current, text: "", dirty: false })),
      cleanA: () => setA(CLEAN),
      setB,
    };
  }, [setA, setB]);

  return (
    <>
      <input aria-label="Draft A" readOnly value={a.text} />
      <button onClick={() => guard.requestTransition(leave)}>Leave</button>
      {b === null ? null : <OtherDraft draft={b} />}
    </>
  );
}

function openEditor(delayedDiscard = false) {
  return render(
    <NavigationGuardProvider>
      <Editor delayedDiscard={delayedDiscard} />
    </NavigationGuardProvider>,
  );
}

function startSave() {
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  expect(save).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
}

async function completeSave(saved = true) {
  await act(async () => completion.resolve(saved));
}

/**
 * Hold native traversal requests until the test releases their actual event.
 * This exercises the removal race without manufacturing a popstate event or
 * depending on a timer to insert work between the request and its completion.
 */
async function flushNextHistory() {
  const next = queuedHistory.shift();
  expect(next).toBeDefined();
  const before = nativePopCount;
  await act(async () => {
    await new Promise<void>((resolve) => {
      popDelivered = resolve;
      next?.();
    });
  });
  expect(nativePopCount).toBeGreaterThan(before);
}

async function flushHistory() {
  for (let step = 0; queuedHistory.length > 0 && step < 8; step += 1)
    await flushNextHistory();
  expect(queuedHistory).toHaveLength(0);
}

beforeEach(() => {
  leave.mockReset();
  discardA.mockReset();
  discardB.mockReset();
  completion = deferred<boolean>();
  save.mockReset().mockReturnValue(completion.promise);
  queuedHistory = [];
  nativePopCount = 0;
  popDelivered = undefined;
  window.history.replaceState(
    { __NA: true, appNavigationIndex: 0 },
    "",
    PREVIOUS,
  );
  stopTracking = trackAppHistory();
  window.history.pushState({ __NA: true }, "", PAGE);

  const back = window.history.back.bind(window.history);
  const forward = window.history.forward.bind(window.history);
  const go = window.history.go.bind(window.history);
  vi.spyOn(window.history, "back").mockImplementation(() =>
    queuedHistory.push(back),
  );
  vi.spyOn(window.history, "forward").mockImplementation(() =>
    queuedHistory.push(forward),
  );
  vi.spyOn(window.history, "go").mockImplementation((delta) => {
    queuedHistory.push(() => go(delta));
  });
  // Observe only event delivery; URL isolation is covered by the real Next harness.
  countPop = () => {
    nativePopCount += 1;
    popDelivered?.();
    popDelivered = undefined;
  };
  window.addEventListener("popstate", countPop, true);
});

afterEach(() => {
  cleanup();
  stopTracking();
  window.removeEventListener("popstate", countPop, true);
  vi.restoreAllMocks();
});

describe("save approval uses current draft registrations", () => {
  it("continues once for a sole true-returning Floor save that cleans through React", async () => {
    openEditor();
    startSave();
    await completeSave();
    expect(screen.getByLabelText("Draft A")).toHaveValue("");
    expect(leave).not.toHaveBeenCalled();
    await flushHistory();
    expect(leave).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(discardA).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "pending", text: "", dirty: false, pending: true },
    { kind: "dirty", text: "Second draft", dirty: true, pending: false },
  ])(
    "retains a fresh decision while B is $kind, even after B later settles",
    async ({ text, dirty, pending }) => {
      openEditor();
      startSave();
      act(() => controls.setB({ text, dirty, pending }));
      await completeSave();
      await flushHistory();

      expect(leave).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByLabelText("Draft B")).toHaveValue(text);
      expect(discardB).not.toHaveBeenCalled();
      if (pending)
        expect(
          screen.getByRole("button", { name: "Discard changes" }),
        ).toBeDisabled();

      act(() => controls.setB(CLEAN));
      await flushHistory();
      expect(leave).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
      await flushHistory();
      expect(leave).toHaveBeenCalledOnce();
      expect(discardA).not.toHaveBeenCalled();
      expect(discardB).not.toHaveBeenCalled();
    },
  );

  it("does not settle a fresh A draft when the previous save returns true", async () => {
    openEditor();
    startSave();
    act(() => controls.reportSavedA());
    act(() => controls.editA("Fresh Floor draft"));
    await completeSave();
    await flushHistory();
    expect(leave).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Draft A")).toHaveValue("Fresh Floor draft");
    expect(discardA).not.toHaveBeenCalled();
  });

  it.each(["false", "rejection"])(
    "retains the draft after save %s",
    async (outcome) => {
      openEditor();
      startSave();
      if (outcome === "false") await completeSave(false);
      else await act(async () => completion.reject(new Error("offline")));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Your changes are still here",
      );
      expect(screen.getByLabelText("Draft A")).toHaveValue("Floor draft");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Save and continue" }),
      ).toBeEnabled();
      expect(leave).not.toHaveBeenCalled();
      expect(discardA).not.toHaveBeenCalled();
      expect(queuedHistory).toHaveLength(0);
    },
  );
});

describe("deferred history removal revalidates approval", () => {
  it.each([
    { kind: "pending", text: "", dirty: false, pending: true },
    { kind: "dirty", text: "Late draft", dirty: true, pending: false },
  ])(
    "protects B becoming $kind after save approval but before removal completes",
    async ({ text, dirty, pending }) => {
      openEditor();
      startSave();
      await completeSave();
      expect(queuedHistory).toHaveLength(1);
      act(() => controls.setB({ text, dirty, pending }));
      await flushHistory();
      expect(leave).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByLabelText("Draft B")).toHaveValue(text);
      expect(discardB).not.toHaveBeenCalled();
      if (pending)
        expect(
          screen.getByTestId("navigation-guard-pending"),
        ).toBeInTheDocument();
    },
  );

  it("invalidates an approved action when a route write supersedes removal", async () => {
    openEditor();
    startSave();
    await completeSave();
    expect(queuedHistory).toHaveLength(1);
    act(() => window.history.pushState({ __NA: true }, "", OTHER));
    await flushHistory();
    expect(leave).not.toHaveBeenCalled();
    expect(discardA).not.toHaveBeenCalled();
  });

  it("continues once after Discard even if its clean registration report is delayed", async () => {
    openEditor(true);
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Draft A")).toHaveValue("");
    expect(discardA).toHaveBeenCalledOnce();
    await flushHistory();
    expect(leave).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => controls.cleanA());
    await flushHistory();
    expect(leave).toHaveBeenCalledOnce();
    expect(discardA).toHaveBeenCalledOnce();
  });

  it("protects a new pending B after Discard but before removal completes", async () => {
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(queuedHistory).toHaveLength(1);
    act(() => controls.setB({ text: "", dirty: false, pending: true }));
    await flushHistory();
    expect(leave).not.toHaveBeenCalled();
    expect(discardA).toHaveBeenCalledOnce();
    expect(discardB).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Discard changes" }),
    ).toBeDisabled();
  });
});

describe("a save attempt cannot release an obsolete navigation intent", () => {
  it("preserves the newer Back prompt until a fresh decision, without running the old action", async () => {
    openEditor();
    startSave();
    act(() =>
      controls.setB({ text: "Second draft", dirty: true, pending: false }),
    );
    act(() => window.history.back());
    await flushHistory();
    expect(window.location.pathname).toBe(PAGE);
    expect(isGuardTraversal()).toBe(false);
    await completeSave();
    await flushHistory();
    expect(leave).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Draft B")).toHaveValue("Second draft");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(leave).not.toHaveBeenCalled();
    expect(discardB).not.toHaveBeenCalled();
  });

  it("does not run a save continuation after its owner unmounts", async () => {
    const view = openEditor();
    startSave();
    view.unmount();
    await completeSave();
    await flushHistory();
    expect(leave).not.toHaveBeenCalled();
    expect(discardA).not.toHaveBeenCalled();
  });

  it("does not release an old save into a newly mounted owner's draft", async () => {
    const old = openEditor();
    startSave();
    old.unmount();
    openEditor();
    act(() => controls.editA("New owner draft"));
    await completeSave();
    await flushHistory();
    expect(leave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Draft A")).toHaveValue("New owner draft");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(discardA).not.toHaveBeenCalled();
  });

  it("does not run an approved removal continuation after its owner unmounts", async () => {
    const view = openEditor();
    startSave();
    await completeSave();
    expect(queuedHistory).toHaveLength(1);
    view.unmount();
    await flushHistory();
    expect(leave).not.toHaveBeenCalled();
  });
});

describe("superseded approvals retain protection and request identity", () => {
  it.each(["push", "replace"] as const)(
    "keeps pending work guarded after a same-page %s supersedes removal",
    async (mode) => {
      openEditor();
      startSave();
      await completeSave();
      act(() => controls.setB({ text: "", dirty: false, pending: true }));
      act(() =>
        updateBrowserQuery((query) => query.set("panel", "list"), { mode }),
      );
      await flushHistory();
      expect(leave).not.toHaveBeenCalled();
      if (screen.queryByRole("dialog"))
        fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

      act(() => window.history.back());
      await flushHistory();
      expect(window.location.pathname).toBe(PAGE);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Discard changes" }),
      ).toBeDisabled();
      expect(leave).not.toHaveBeenCalled();
    },
  );

  it("retains a newer request when delayed Discard still reports covered work", async () => {
    const newer = vi.fn();
    openEditor(true);
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(queuedHistory).toHaveLength(1);
    act(() => guardedNavigate(newer));
    await flushHistory();
    expect(leave).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    act(() => controls.cleanA());
    await flushHistory();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await flushHistory();
    expect(newer).toHaveBeenCalledOnce();
    expect(leave).not.toHaveBeenCalled();
  });

  it("does not replay an approval from a prior Activity connection on the next Back", async () => {
    // Provider lifecycle contract: this does not establish a real route's reachability.
    const tree = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <NavigationGuardProvider>
          <Editor />
        </NavigationGuardProvider>
      </Activity>
    );
    const view = render(tree("visible"));
    startSave();
    await completeSave();
    expect(queuedHistory).toHaveLength(1);
    view.rerender(tree("hidden"));
    await flushHistory();
    view.rerender(tree("visible"));

    act(() => window.history.back());
    await flushHistory();
    expect(leave).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(PREVIOUS);
  });
});
