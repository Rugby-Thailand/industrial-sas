import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routing = vi.hoisted(() => ({ router: { push: vi.fn() }, locale: "en" }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => routing.router }));
vi.mock("next-intl", () => ({ useLocale: () => routing.locale }));

import { trackAppHistory } from "@/lib/browser/appHistory";
import { updateBrowserQuery } from "@/lib/browser/history";
import {
  guardedNavigate,
  isGuardTraversal,
  onNavigationIntent,
} from "@/lib/navigationGuard";

import {
  NavigationGuardProvider,
  useNavigationDraft,
  type NavigationDraftControl,
} from "./NavigationGuardProvider";

const PAGE = "/en/master-data/storage-layouts/building";
const save = vi.fn<() => Promise<boolean>>();
const discard = vi.fn();
const transition = vi.fn();

function Editor({
  dirty = true,
  pending = false,
  saveable = true,
  saveBlockedReason,
  destination = "/en/finished-goods",
  name = "Switch floor",
  onControl,
}: {
  dirty?: boolean;
  pending?: boolean;
  saveable?: boolean;
  saveBlockedReason?: string;
  destination?: string;
  name?: string;
  onControl?: (control: NavigationDraftControl) => void;
}) {
  const guard = useNavigationDraft({
    dirty,
    pending,
    discard,
    ...(saveable ? { save } : {}),
    ...(saveBlockedReason ? { saveBlockedReason } : {}),
  });
  onControl?.(guard);
  return (
    <>
      <button onClick={() => guard.requestTransition(transition)}>
        {name}
      </button>
      {/* Native links: the owner also protects anchors outside Next Link. */}
      <a href={destination}>Stock</a>
    </>
  );
}

const owned = (children: ReactNode) => (
  <NavigationGuardProvider>{children}</NavigationGuardProvider>
);

function pop(state: unknown, url = PAGE) {
  act(() => {
    window.history.replaceState(state, "", url);
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  });
}
const finishRemoval = () => pop({ __NA: true });

beforeEach(() => {
  routing.locale = "en";
  routing.router.push.mockReset();
  save.mockReset().mockResolvedValue(true);
  discard.mockReset();
  transition.mockReset();
  window.history.replaceState({ __NA: true }, "", PAGE);
  vi.spyOn(window.history, "back").mockImplementation(() => {});
  vi.spyOn(window.history, "forward").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("single navigation guard owner", () => {
  it("allows clean transitions without prompting or adding a history entry", () => {
    const push = vi.spyOn(window.history, "pushState");
    render(owned(<Editor dirty={false} />));
    fireEvent.click(screen.getByText("Switch floor"));
    expect(transition).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the draft and cancels a requested transition", () => {
    render(owned(<Editor />));
    fireEvent.click(screen.getByText("Switch floor"));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(discard).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("only continues after explicitly discarding and removing its history buffer", () => {
    render(owned(<Editor />));
    fireEvent.click(screen.getByText("Switch floor"));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(discard).toHaveBeenCalledOnce();
    expect(transition).not.toHaveBeenCalled();
    finishRemoval();
    expect(transition).toHaveBeenCalledOnce();
    expect(window.history.state).toEqual({ __NA: true });
  });

  it.each([false, "exception"])(
    "retains draft and pending transition when save returns %s",
    async (result) => {
      if (result === "exception") save.mockRejectedValue(new Error("offline"));
      else save.mockResolvedValue(false);
      render(owned(<Editor />));
      fireEvent.click(screen.getByText("Switch floor"));
      fireEvent.click(
        screen.getByRole("button", { name: "Save and continue" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Your changes are still here",
      );
      expect(transition).not.toHaveBeenCalled();
      expect(discard).not.toHaveBeenCalled();
      save.mockResolvedValue(true);
      fireEvent.click(
        screen.getByRole("button", { name: "Save and continue" }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      finishRemoval();
      expect(transition).toHaveBeenCalledOnce();
    },
  );

  it("prevents duplicate save, discard, and dismiss while saving", async () => {
    let resolve!: (saved: boolean) => void;
    save.mockReturnValue(
      new Promise((finish) => {
        resolve = finish;
      }),
    );
    render(owned(<Editor />));
    fireEvent.click(screen.getByText("Switch floor"));
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard changes" }),
    ).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(save).toHaveBeenCalledOnce();
    await act(async () => resolve(true));
    finishRemoval();
    expect(transition).toHaveBeenCalledOnce();
  });

  it("intercepts same-origin links before navigation and preserves the chosen destination", () => {
    render(owned(<Editor />));
    fireEvent.click(screen.getByRole("link", { name: "Stock" }));
    expect(routing.router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    finishRemoval();
    expect(routing.router.push).toHaveBeenCalledWith("/finished-goods", {
      locale: "en",
    });
  });

  it("preserves a link's locale when a dirty editor switches locale", () => {
    render(owned(<Editor destination="/th/finished-goods" />));
    fireEvent.click(screen.getByRole("link", { name: "Stock" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    finishRemoval();
    expect(routing.router.push).toHaveBeenCalledWith("/finished-goods", {
      locale: "th",
    });
  });

  it("restores browser Back before Next sees it, then allows Back after discard", () => {
    render(owned(<Editor />));
    const bufferedState = window.history.state;
    const nextListener = vi.fn();
    window.addEventListener("popstate", nextListener);
    pop({ __NA: true });
    expect(window.history.forward).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pop(bufferedState);
    expect(nextListener).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(window.history.back).not.toHaveBeenCalled();
    pop({ __NA: true });
    pop(bufferedState);
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(window.history.back).toHaveBeenCalledTimes(1);
    finishRemoval();
    expect(window.history.back).toHaveBeenCalledTimes(2);
    expect(nextListener).not.toHaveBeenCalled();
    window.removeEventListener("popstate", nextListener);
  });

  it("preserves an actual browser history Back/keep/Back/discard sequence", async () => {
    vi.mocked(window.history.back).mockRestore();
    vi.mocked(window.history.forward).mockRestore();
    window.history.replaceState({ __NA: true }, "", "/en/finished-goods");
    window.history.pushState({ __NA: true }, "", PAGE);
    render(owned(<Editor />));
    act(() => window.history.back());
    await screen.findByRole("dialog");
    await waitFor(() =>
      expect(window.history.state.__storageWorkspaceGuard).toBeDefined(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(window.location.pathname).toBe(
      "/en/master-data/storage-layouts/building",
    );
    act(() => window.history.back());
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect(window.location.pathname).toBe("/en/finished-goods"),
    );
    expect(discard).toHaveBeenCalledOnce();
  });

  it("keeps Back guarded after Next refreshes the active page entry", async () => {
    vi.mocked(window.history.back).mockRestore();
    vi.mocked(window.history.forward).mockRestore();
    window.history.replaceState({ __NA: true }, "", "/en/finished-goods");
    window.history.pushState({ __NA: true }, "", PAGE);
    const stopTracking = trackAppHistory();
    render(owned(<Editor />));
    // Clicking the active link: Next replaces the buffer entry's router tree.
    act(() =>
      window.history.replaceState(
        { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: "fresh" } },
        "",
        PAGE,
      ),
    );
    expect(window.history.state.__storageWorkspaceGuard).toBeDefined();
    act(() => window.history.back());
    await screen.findByRole("dialog");
    await waitFor(() => expect(isGuardTraversal()).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(window.location.pathname).toBe(
      "/en/master-data/storage-layouts/building",
    );
    act(() => window.history.back());
    await screen.findByRole("dialog");
    await waitFor(() => expect(isGuardTraversal()).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect(window.location.pathname).toBe("/en/finished-goods"),
    );
    stopTracking();
  });

  it("waits for a pending Back restoration before removing the buffer", () => {
    render(owned(<Editor />));
    const bufferedState = window.history.state;
    pop({ __NA: true });
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(window.history.back).not.toHaveBeenCalled();
    pop(bufferedState);
    expect(window.history.back).toHaveBeenCalledTimes(1);
    finishRemoval();
    expect(window.history.back).toHaveBeenCalledTimes(2);
  });

  it("warns on document unload only while dirty and removes buffer after an ordinary save", () => {
    const view = render(owned(<Editor />));
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    view.rerender(owned(<Editor dirty={false} />));
    finishRemoval();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    expect(window.history.state).toEqual({ __NA: true });
  });

  it("re-arms when another edit arrives before an ordinary save finishes removing its buffer", () => {
    const view = render(owned(<Editor />));
    view.rerender(owned(<Editor dirty={false} />));
    view.rerender(owned(<Editor dirty />));
    finishRemoval();
    expect(window.history.state.__storageWorkspaceGuard).toBeDefined();
    const bufferedState = window.history.state;
    pop({ __NA: true });
    pop(bufferedState);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(transition).not.toHaveBeenCalled();
  });

  it("explains an unfinished nested editor and blocks only Save", () => {
    const reason =
      "Finish or cancel the open area editor before saving the floor.";
    const view = render(owned(<Editor saveBlockedReason={reason} />));
    fireEvent.click(screen.getByText("Switch floor"));
    expect(screen.getByRole("status")).toHaveTextContent(reason);
    expect(
      screen.getByRole("button", { name: "Save and continue" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep editing" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Discard changes" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(discard).not.toHaveBeenCalled();
    view.rerender(owned(<Editor />));
    fireEvent.click(screen.getByText("Switch floor"));
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save and continue" }),
    ).toBeEnabled();
  });

  it("signals guard traversal only while restoring or removing its buffer", () => {
    expect(isGuardTraversal()).toBe(false);
    const view = render(owned(<Editor dirty={false} />));
    view.rerender(owned(<Editor />));
    expect(isGuardTraversal()).toBe(false);
    const bufferedState = window.history.state;
    const refreshed = vi.fn();
    window.addEventListener("app-query-state", refreshed);
    pop({ __NA: true });
    expect(isGuardTraversal()).toBe(true);
    pop(bufferedState);
    expect(isGuardTraversal()).toBe(false);
    // The suppressed Back never reached query subscribers: refresh them.
    expect(refreshed).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByText("Switch floor"));
    transition.mockImplementationOnce(() =>
      expect(isGuardTraversal()).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(isGuardTraversal()).toBe(true);
    finishRemoval();
    expect(isGuardTraversal()).toBe(false);
    expect(refreshed).toHaveBeenCalledTimes(2);
    expect(transition).toHaveBeenCalledOnce();
    window.removeEventListener("app-query-state", refreshed);
  });

  it("releases the traversal signal and bridge when the owner unmounts", () => {
    const view = render(owned(<Editor />));
    pop({ __NA: true });
    expect(isGuardTraversal()).toBe(true);
    view.unmount();
    expect(isGuardTraversal()).toBe(false);
    const action = vi.fn();
    guardedNavigate(action);
    expect(action).toHaveBeenCalledOnce();
  });

  it("provides the same decisions in Thai and disables them during an external save", () => {
    routing.locale = "th";
    render(owned(<Editor dirty={false} pending />));
    fireEvent.click(screen.getByText("Switch floor"));
    expect(
      screen.getByRole("dialog", { name: "บันทึกการเปลี่ยนแปลงก่อนออก?" }),
    ).toBeInTheDocument();
    // Nothing is dirty, so there is nothing to save.
    expect(
      screen.queryByRole("button", { name: "บันทึกและดำเนินการต่อ" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ละทิ้งการเปลี่ยนแปลง" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "แก้ไขต่อ" })).toBeEnabled();
  });
});

describe("several registered drafts", () => {
  it("uses one buffer and one prompt, and offers Save only for a sole saveable draft", () => {
    const push = vi.spyOn(window.history, "pushState");
    const view = render(
      owned(
        <>
          <Editor name="Storage" />
          <Editor name="HR" saveable={false} />
        </>,
      ),
    );
    expect(push).toHaveBeenCalledOnce();
    act(() => guardedNavigate(transition));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Save and continue" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    view.rerender(
      owned(
        <>
          <Editor name="Storage" />
          <Editor name="HR" dirty={false} saveable={false} />
        </>,
      ),
    );
    expect(push).toHaveBeenCalledOnce();
    act(() => guardedNavigate(transition));
    expect(
      screen.getByRole("button", { name: "Save and continue" }),
    ).toBeEnabled();
  });

  it("discards every dirty draft once and navigates once", () => {
    render(
      owned(
        <>
          <Editor name="Storage" />
          <Editor name="HR" saveable={false} />
        </>,
      ),
    );
    act(() => guardedNavigate(transition));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(discard).toHaveBeenCalledTimes(2);
    expect(window.history.back).toHaveBeenCalledOnce();
    finishRemoval();
    expect(transition).toHaveBeenCalledOnce();
  });

  it("blocks discard while any draft is pending but keeps Keep editing available", () => {
    render(
      owned(
        <>
          <Editor name="Storage" />
          <Editor name="HR" dirty={false} pending saveable={false} />
        </>,
      ),
    );
    act(() => guardedNavigate(transition));
    expect(screen.getByTestId("navigation-guard-pending")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(discard).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Save and continue" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(transition).not.toHaveBeenCalled();
  });
});

describe("settled completion", () => {
  it("navigates only after the buffer is removed, even before the editor re-renders clean", () => {
    let control!: NavigationDraftControl;
    const view = render(
      owned(
        <Editor
          pending
          onControl={(next) => {
            control = next;
          }}
        />,
      ),
    );
    const navigate = vi.fn();
    // A write resolves: the completion settles and navigates in one task,
    // while the last rendered registration still says dirty and pending.
    act(() => control.settle(navigate));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(window.history.back).toHaveBeenCalledOnce();
    // A stale dirty report during removal must not re-arm the guard.
    view.rerender(owned(<Editor onControl={(next) => (control = next)} />));
    finishRemoval();
    expect(navigate).toHaveBeenCalledOnce();
    expect(window.history.state.__storageWorkspaceGuard).toBeUndefined();
    act(() => guardedNavigate(transition));
    expect(transition).toHaveBeenCalledOnce();
    // Once it reports clean, a new edit is guarded again.
    view.rerender(
      owned(<Editor dirty={false} onControl={(next) => (control = next)} />),
    );
    view.rerender(owned(<Editor onControl={(next) => (control = next)} />));
    expect(window.history.state.__storageWorkspaceGuard).toBeDefined();
  });

  it("continues through the prompt when another draft is still dirty", () => {
    let control!: NavigationDraftControl;
    render(
      owned(
        <>
          <Editor name="Period" onControl={(next) => (control = next)} />
          <Editor name="Other" saveable={false} />
        </>,
      ),
    );
    const navigate = vi.fn();
    act(() => control.settle(navigate));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(discard).toHaveBeenCalledOnce();
    finishRemoval();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("runs the continuation directly when nothing is buffered", () => {
    let control!: NavigationDraftControl;
    render(
      owned(<Editor dirty={false} onControl={(next) => (control = next)} />),
    );
    const navigate = vi.fn();
    act(() => control.settle(navigate));
    expect(navigate).toHaveBeenCalledOnce();
    expect(window.history.back).not.toHaveBeenCalled();
  });

  it("never steps Back when an editor unmounts after history left its page", () => {
    const stopTracking = trackAppHistory();
    const view = render(owned(<Editor />));
    // An unguarded route change (e.g. a landing redirect) commits first;
    // the old page's editor unmounts afterwards.
    act(() => window.history.pushState({ __NA: true }, "", "/en/hr/today"));
    view.rerender(owned(<p>Today</p>));
    expect(window.history.back).not.toHaveBeenCalled();
    act(() => guardedNavigate(transition));
    expect(transition).toHaveBeenCalledOnce();
    stopTracking();
  });

  it("removes the buffer when a closed editor unmounts on the same page", () => {
    const view = render(owned(<Editor />));
    view.rerender(owned(<p>Editor closed</p>));
    expect(window.history.back).toHaveBeenCalledOnce();
    finishRemoval();
    expect(window.history.state.__storageWorkspaceGuard).toBeUndefined();
  });

  it("reuses a buffer left by a remounted owner or a reload instead of stacking another", () => {
    const push = vi.spyOn(window.history, "pushState");
    const first = render(owned(<Editor />));
    expect(push).toHaveBeenCalledOnce();
    first.unmount();
    // Account switch: a new owner mounts on the same buffer entry.
    const second = render(owned(<Editor />));
    expect(push).toHaveBeenCalledOnce();
    second.rerender(owned(<Editor dirty={false} />));
    expect(window.history.back).toHaveBeenCalledOnce();
    finishRemoval();
    second.unmount();

    // A reload restores history.state with an old buffer marker. Mounting
    // never traverses it; a restored draft reuses it as its buffer.
    window.history.replaceState(
      { __NA: true, __storageWorkspaceGuard: "from-before-reload" },
      "",
      PAGE,
    );
    const reloaded = render(owned(<Editor dirty={false} />));
    expect(window.history.back).toHaveBeenCalledOnce();
    reloaded.rerender(owned(<Editor />));
    expect(push).toHaveBeenCalledOnce();
    act(() => guardedNavigate(transition));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(window.history.back).toHaveBeenCalledTimes(2);
    finishRemoval();
    expect(transition).toHaveBeenCalledOnce();
  });

  it("does not traverse history when the whole shell unmounts", () => {
    const view = render(owned(<Editor />));
    view.unmount();
    expect(window.history.back).not.toHaveBeenCalled();
  });

  it("does not let a write that overtakes buffer removal swallow the next real Back", () => {
    const stopTracking = trackAppHistory();
    render(owned(<Editor />));
    fireEvent.click(screen.getByText("Switch floor"));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(isGuardTraversal()).toBe(true);
    // A navigation commits before the buffer traversal arrives.
    act(() =>
      window.history.pushState({ __NA: true }, "", "/en/finished-goods"),
    );
    expect(isGuardTraversal()).toBe(false);
    expect(transition).toHaveBeenCalledOnce();
    const next = vi.fn();
    window.addEventListener("popstate", next);
    pop({ __NA: true }, PAGE);
    expect(next).toHaveBeenCalledOnce();
    window.removeEventListener("popstate", next);
    stopTracking();
  });
});

describe("guard entry left by a previous document", () => {
  const PREVIOUS = "/en/finished-goods";
  let stopTracking: () => void;

  /**
   * Real jsdom history: PREVIOUS@0, the page's base@1 and, on top, a guard
   * entry a reloaded document left behind (its unsaved state is gone).
   */
  beforeEach(() => {
    vi.mocked(window.history.back).mockRestore();
    vi.mocked(window.history.forward).mockRestore();
    window.history.replaceState({ __NA: true }, "", PREVIOUS);
    stopTracking = trackAppHistory();
    window.history.pushState({ __NA: true, tree: "floor" }, "", PAGE);
    window.history.pushState(
      { __NA: true, tree: "floor", __storageWorkspaceGuard: "old-document" },
      "",
      PAGE,
    );
  });
  afterEach(() => stopTracking());

  /** A Map/List style query replacement of the current entry. */
  function replaceQuery(search: string, state = { ...window.history.state }) {
    delete state.__NA;
    act(() => window.history.replaceState(state, "", `${PAGE}${search}`));
  }
  const at = () => window.location.pathname + window.location.search;
  /** One real Back, resolved when a traversal reaches ordinary listeners. */
  async function back() {
    const landed = vi.fn();
    window.addEventListener("popstate", landed);
    act(() => window.history.back());
    await waitFor(() => expect(landed).toHaveBeenCalled());
    window.removeEventListener("popstate", landed);
    return at();
  }

  it.each([
    ["plain", (node: ReactNode) => node],
    ["Strict Mode", (node: ReactNode) => <StrictMode>{node}</StrictMode>],
  ])(
    "one Back reaches the previous page after a clean %s owner replaces the query",
    async (_, wrap) => {
      render(wrap(owned(<Editor dirty={false} />)));
      replaceQuery("?panel=list");
      expect(window.history.state).toMatchObject({
        tree: "floor",
        __storageWorkspaceGuard: "old-document",
      });
      // A metadata-only write is not a departure either.
      act(() =>
        window.history.replaceState(
          { ...window.history.state, catalogue: "kept" },
          "",
        ),
      );
      expect(await back()).toBe(PREVIOUS);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it("does not skip the page after a replacement leaves the route", async () => {
    render(owned(<Editor dirty={false} />));
    act(() => window.history.replaceState({ __NA: true }, "", "/en/hr/today"));
    // The first event to reach ordinary listeners is the page itself.
    expect(await back()).toBe(PAGE);
  });

  it("does not skip the page after a replacement changes the guard marker", async () => {
    render(owned(<Editor dirty={false} />));
    replaceQuery("?panel=list", {
      ...window.history.state,
      __storageWorkspaceGuard: "another-owner",
    });
    expect(await back()).toBe(PAGE);
  });

  it("treats a pushed query that copied the marker as a new page step", async () => {
    render(owned(<Editor dirty={false} />));
    act(() =>
      window.history.pushState(
        { ...window.history.state },
        "",
        `${PAGE}?panel=list`,
      ),
    );
    expect(window.history.state.appNavigationIndex).toBe(2);
    expect(await back()).toBe(PAGE);
    // The legacy guard entry is the current page again; its base is skipped.
    expect(await back()).toBe(PREVIOUS);
  });
});

describe("same-page push while work is guarded", () => {
  const PREVIOUS = "/en/finished-goods";
  const GUARD = "__storageWorkspaceGuard";
  let stopTracking: () => void;
  let restoreNextPatch: () => void;
  /** URLs Next's patched pushState would sync into its router. */
  let nextUrlSyncs: string[];

  /**
   * Real jsdom history: PREVIOUS@0 and the page@1, tracked, with Next's
   * patched pushState (app-router.js, next 16.3.8) captured on top of the
   * tracker, as in the app: it passes `__NA` writes through, otherwise
   * copies Next's markers from the current entry and syncs the URL.
   */
  beforeEach(() => {
    vi.mocked(window.history.back).mockRestore();
    vi.mocked(window.history.forward).mockRestore();
    window.history.replaceState({ __NA: true }, "", PREVIOUS);
    stopTracking = trackAppHistory();
    window.history.pushState({ __NA: true }, "", PAGE);
    nextUrlSyncs = [];
    const original = window.history.pushState.bind(window.history);
    const patched = window.history.pushState;
    window.history.pushState = function pushState(data, unused, url) {
      if (data?.__NA || data?._N) return original(data, unused, url);
      const copied = { ...data };
      if (window.history.state?.__NA) copied.__NA = window.history.state.__NA;
      if (url) nextUrlSyncs.push(String(url));
      return original(copied, unused, url);
    };
    restoreNextPatch = () => {
      window.history.pushState = patched;
    };
  });
  afterEach(() => {
    restoreNextPatch();
    stopTracking();
  });

  const at = () => window.location.pathname + window.location.search;
  async function back() {
    const landed = vi.fn();
    window.addEventListener("popstate", landed);
    act(() => window.history.back());
    await waitFor(() => expect(landed).toHaveBeenCalled());
    window.removeEventListener("popstate", landed);
    return at();
  }

  it("guards the pushed entry once, then one discard returns to the previous view", async () => {
    const view = render(owned(<Editor />));
    const first: unknown = window.history.state[GUARD];
    expect(window.history.state.appNavigationIndex).toBe(1);
    act(() =>
      updateBrowserQuery((query) => query.set("panel", "list"), {
        mode: "push",
      }),
    );
    // Next synced the query push only; the nested buffer passed through.
    expect(nextUrlSyncs).toEqual([`${PAGE}?panel=list`]);
    expect(at()).toBe(`${PAGE}?panel=list`);
    const second: unknown = window.history.state[GUARD];
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
    expect(window.history.state).toMatchObject({
      __NA: true,
      appNavigationIndex: 2,
    });
    // Next's later same-URL commit keeps the new buffer's marker.
    act(() =>
      window.history.replaceState({ __NA: true }, "", `${PAGE}?panel=list`),
    );
    expect(window.history.state[GUARD]).toBe(second);

    act(() => window.history.back());
    await screen.findByRole("dialog");
    await waitFor(() => expect(isGuardTraversal()).toBe(false));
    expect(window.history.state[GUARD]).toBe(second);
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(at()).toBe(PAGE));
    expect(discard).toHaveBeenCalledOnce();
    view.rerender(owned(<Editor dirty={false} />));
    // The superseded buffer is now unowned; Back skips its duplicate base.
    expect(window.history.state[GUARD]).toBe(first);
    expect(await back()).toBe(PREVIOUS);
    expect(nextUrlSyncs).toHaveLength(1);
  });

  it.each([
    {
      write: "pushes another route",
      pushes: 1,
      run: () => window.history.pushState({ __NA: true }, "", PREVIOUS),
    },
    {
      write: "replaces the entry and drops the marker",
      pushes: 0,
      run: () => window.history.replaceState({ __NA: true }, "", `${PAGE}?q=a`),
    },
  ])("does not re-arm when a write $write", ({ pushes, run }) => {
    render(owned(<Editor />));
    const push = vi.spyOn(window.history, "pushState");
    act(run);
    expect(push).toHaveBeenCalledTimes(pushes);
    push.mockRestore();
    expect(window.history.state[GUARD]).toBeUndefined();
  });
});

describe("superseded restoration", () => {
  it("does not let a write that overtakes a Back restoration swallow the next real Back", () => {
    const stopTracking = trackAppHistory();
    render(owned(<Editor />));
    pop({ __NA: true });
    expect(isGuardTraversal()).toBe(true);
    act(() =>
      window.history.pushState({ __NA: true }, "", "/en/finished-goods"),
    );
    expect(isGuardTraversal()).toBe(false);
    const next = vi.fn();
    window.addEventListener("popstate", next);
    pop({ __NA: true }, PAGE);
    expect(next).toHaveBeenCalled();
    window.removeEventListener("popstate", next);
    stopTracking();
  });
});

describe("conditional unload protection", () => {
  /** Live beforeunload listeners on window, observed through add/remove. */
  function trackUnloadListeners() {
    const live = new Set<unknown>();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation(
      (type: string, listener: unknown, options?: unknown) => {
        if (type === "beforeunload") live.add(listener);
        add(type, listener as EventListener, options as never);
      },
    );
    vi.spyOn(window, "removeEventListener").mockImplementation(
      (type: string, listener: unknown, options?: unknown) => {
        if (type === "beforeunload") live.delete(listener);
        remove(type, listener as EventListener, options as never);
      },
    );
    return live;
  }
  const unloadBlocked = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it("attaches only while dirty and removes the listener once clean", () => {
    const live = trackUnloadListeners();
    const view = render(owned(<Editor dirty={false} />));
    expect(live.size).toBe(0);
    view.rerender(owned(<Editor />));
    expect(live.size).toBe(1);
    expect(unloadBlocked()).toBe(true);
    view.rerender(owned(<Editor dirty={false} />));
    expect(live.size).toBe(0);
    expect(unloadBlocked()).toBe(false);
  });

  it("protects a pending-only write and removes the listener when it settles", () => {
    const live = trackUnloadListeners();
    let control!: NavigationDraftControl;
    render(
      owned(
        <Editor
          dirty={false}
          pending
          onControl={(next) => {
            control = next;
          }}
        />,
      ),
    );
    expect(live.size).toBe(1);
    expect(unloadBlocked()).toBe(true);
    act(() => control.settle());
    expect(live.size).toBe(0);
  });

  it("stays attached until the last of several editors is clean or unregistered", () => {
    const live = trackUnloadListeners();
    const view = render(
      owned(
        <>
          <Editor name="Storage" />
          <Editor name="HR" saveable={false} />
        </>,
      ),
    );
    expect(live.size).toBe(1);
    view.rerender(
      owned(
        <>
          <Editor name="Storage" dirty={false} />
          <Editor name="HR" saveable={false} />
        </>,
      ),
    );
    expect(live.size).toBe(1);
    expect(unloadBlocked()).toBe(true);
    view.rerender(owned(<Editor name="Storage" dirty={false} />));
    expect(live.size).toBe(0);
  });

  it("follows the owner's connection through unmount and Strict Mode remount", () => {
    const live = trackUnloadListeners();
    const view = render(<StrictMode>{owned(<Editor />)}</StrictMode>);
    expect(live.size).toBe(1);
    expect(unloadBlocked()).toBe(true);
    view.unmount();
    expect(live.size).toBe(0);
    render(<StrictMode>{owned(<Editor dirty={false} />)}</StrictMode>);
    expect(live.size).toBe(0);
  });
});

describe("bridge consumers", () => {
  it("tells intent listeners only after navigation is permitted", () => {
    const intent = vi.fn();
    const release = onNavigationIntent(intent);
    render(owned(<Editor />));
    act(() => guardedNavigate(transition));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(intent).not.toHaveBeenCalled();
    act(() => guardedNavigate(transition));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(intent).toHaveBeenCalledOnce();
    release();
  });

  it("passes transitions through without an owner and warns once for dirty work", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const intent = vi.fn();
    const release = onNavigationIntent(intent);
    function Standalone() {
      const [dirty, setDirty] = useState(true);
      const guard = useNavigationDraft({
        dirty,
        pending: false,
        discard: () => setDirty(false),
      });
      return (
        <button onClick={() => guard.requestTransition(transition)}>Go</button>
      );
    }
    render(
      <>
        <Standalone />
        <Standalone />
      </>,
    );
    fireEvent.click(screen.getAllByText("Go")[0]!);
    expect(transition).toHaveBeenCalledOnce();
    expect(intent).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    release();
  });

  it("keeps one buffer and owner through a Strict Mode remount", () => {
    const push = vi.spyOn(window.history, "pushState");
    render(<StrictMode>{owned(<Editor />)}</StrictMode>);
    expect(push).toHaveBeenCalledOnce();
    act(() => guardedNavigate(transition));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    finishRemoval();
    expect(transition).toHaveBeenCalledOnce();
  });
});
