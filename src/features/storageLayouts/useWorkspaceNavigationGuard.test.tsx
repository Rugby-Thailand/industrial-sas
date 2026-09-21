import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routing = vi.hoisted(() => ({ router: { push: vi.fn() }, locale: "en" }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => routing.router }));
vi.mock("next-intl", () => ({ useLocale: () => routing.locale }));
import {
  isWorkspaceHistoryGuardActive,
  useWorkspaceNavigationGuard,
} from "./useWorkspaceNavigationGuard";

const save = vi.fn<() => Promise<boolean>>();
const discard = vi.fn();
const transition = vi.fn();
function Harness({
  dirty = true,
  pending = false,
  saveBlockedReason,
  destination = "/en/finished-goods",
}: {
  dirty?: boolean;
  pending?: boolean;
  saveBlockedReason?: string;
  destination?: string;
}) {
  const guard = useWorkspaceNavigationGuard({
    dirty,
    pending,
    save,
    discard,
    ...(saveBlockedReason ? { saveBlockedReason } : {}),
  });
  return (
    <>
      <button onClick={() => guard.requestTransition(transition)}>
        Switch floor
      </button>
      {/* Native links are intentional: the guard also protects anchors outside Next Link. */}
      <a href={destination}>Stock</a>
      {guard.navigationPrompt}
    </>
  );
}

function pop(state: unknown, url = "/en/master-data/storage-layouts/building") {
  act(() => {
    window.history.replaceState(state, "", url);
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  });
}
function finishRemoval() {
  pop({ __NA: true });
}

beforeEach(() => {
  routing.locale = "en";
  routing.router.push.mockReset();
  save.mockReset().mockResolvedValue(true);
  discard.mockReset();
  transition.mockReset();
  window.history.replaceState(
    { __NA: true },
    "",
    "/en/master-data/storage-layouts/building",
  );
  vi.spyOn(window.history, "back").mockImplementation(() => {});
  vi.spyOn(window.history, "forward").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("workspace navigation guard", () => {
  it("allows clean transitions without prompting or adding a history entry", () => {
    const push = vi.spyOn(window.history, "pushState");
    render(<Harness dirty={false} />);
    fireEvent.click(screen.getByText("Switch floor"));
    expect(transition).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the draft and cancels a requested transition", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Switch floor"));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(discard).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("only continues after explicitly discarding and removing its history buffer", () => {
    render(<Harness />);
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
      render(<Harness />);
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
    render(<Harness />);
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
    render(<Harness />);
    fireEvent.click(screen.getByRole("link", { name: "Stock" }));
    expect(routing.router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    finishRemoval();
    expect(routing.router.push).toHaveBeenCalledWith("/finished-goods", {
      locale: "en",
    });
  });

  it("preserves a link's locale when a dirty workspace switches locale", () => {
    routing.locale = "en";
    render(<Harness destination="/th/finished-goods" />);
    fireEvent.click(screen.getByRole("link", { name: "Stock" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    finishRemoval();
    expect(routing.router.push).toHaveBeenCalledWith("/finished-goods", {
      locale: "th",
    });
  });

  it("restores browser Back before Next sees it, then allows Back after discard", () => {
    render(<Harness />);
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
    window.history.pushState(
      { __NA: true },
      "",
      "/en/master-data/storage-layouts/building",
    );
    render(<Harness />);
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

  it("waits for a pending Back restoration before removing the buffer", () => {
    render(<Harness />);
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
    const view = render(<Harness />);
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    view.rerender(<Harness dirty={false} />);
    finishRemoval();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    expect(window.history.state).toEqual({ __NA: true });
  });

  it("re-arms when another edit arrives before an ordinary save finishes removing its buffer", () => {
    const view = render(<Harness />);
    view.rerender(<Harness dirty={false} />);
    view.rerender(<Harness dirty />);
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
    const view = render(<Harness saveBlockedReason={reason} />);
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
    view.rerender(<Harness />);
    fireEvent.click(screen.getByText("Switch floor"));
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save and continue" }),
    ).toBeEnabled();
  });

  it("holds the shared history signal through restoration and releases it before approved actions", () => {
    expect(isWorkspaceHistoryGuardActive()).toBe(false);
    const view = render(<Harness dirty={false} />);
    expect(isWorkspaceHistoryGuardActive()).toBe(false);
    view.rerender(<Harness />);
    expect(isWorkspaceHistoryGuardActive()).toBe(true);
    const bufferedState = window.history.state;
    pop({ __NA: true });
    expect(isWorkspaceHistoryGuardActive()).toBe(true);
    pop(bufferedState);
    expect(isWorkspaceHistoryGuardActive()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByText("Switch floor"));
    transition.mockImplementationOnce(() =>
      expect(isWorkspaceHistoryGuardActive()).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(isWorkspaceHistoryGuardActive()).toBe(true);
    finishRemoval();
    expect(isWorkspaceHistoryGuardActive()).toBe(false);
    expect(transition).toHaveBeenCalledOnce();
  });

  it("clears the shared history signal after a clean save or unmount", () => {
    const view = render(<Harness />);
    expect(isWorkspaceHistoryGuardActive()).toBe(true);
    view.rerender(<Harness dirty={false} />);
    expect(isWorkspaceHistoryGuardActive()).toBe(true);
    finishRemoval();
    expect(isWorkspaceHistoryGuardActive()).toBe(false);
    view.rerender(<Harness />);
    expect(isWorkspaceHistoryGuardActive()).toBe(true);
    view.unmount();
    expect(isWorkspaceHistoryGuardActive()).toBe(false);
  });

  it("provides the same decisions in Thai and disables them during an external save", () => {
    routing.locale = "th";
    render(<Harness dirty={false} pending />);
    fireEvent.click(screen.getByText("Switch floor"));
    expect(
      screen.getByRole("dialog", { name: "บันทึกการเปลี่ยนแปลงก่อนออก?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "บันทึกและดำเนินการต่อ" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "ละทิ้งการเปลี่ยนแปลง" }),
    ).toBeDisabled();
  });
});
