import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routing = vi.hoisted(() => ({ router: { push: vi.fn() }, locale: "en" }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => routing.router }));
vi.mock("next-intl", () => ({ useLocale: () => routing.locale }));

import {
  guardedNavigate,
  registerTransitionGuard,
} from "@/lib/navigationGuard";
import { useWorkspaceNavigationGuard } from "@/features/storageLayouts/useWorkspaceNavigationGuard";

import { DraftGuardProvider } from "./DraftGuardProvider";
import { useDraftGuard, usePendingGuard } from "./draftGuard";

function Draft() {
  const [reason, setReason] = useState("");
  useDraftGuard(reason !== "", () => setReason(""));
  return (
    <label>
      Reason
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
    </label>
  );
}

/** A clean form whose write is in flight, e.g. a decision without comment. */
function Sending({ pending }: { readonly pending: boolean }) {
  usePendingGuard(pending);
  return null;
}

function StorageEditor({ dirty }: { readonly dirty: boolean }) {
  const guard = useWorkspaceNavigationGuard({
    dirty,
    pending: false,
    save: async () => true,
    discard: () => undefined,
  });
  return guard.navigationPrompt;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/en/hr/review");
});
afterEach(() => vi.clearAllMocks());

describe("navigation guard bridge", () => {
  it("runs a navigation only after every registered guard allows it", () => {
    const calls: string[] = [];
    const action = vi.fn(() => calls.push("navigate"));
    const first = registerTransitionGuard((next) => {
      calls.push("first");
      next();
    });
    let held: (() => void) | undefined;
    const second = registerTransitionGuard((next) => {
      calls.push("second");
      held = next;
    });
    guardedNavigate(action);
    expect(calls).toEqual(["first", "second"]);
    expect(action).not.toHaveBeenCalled();
    held?.();
    expect(action).toHaveBeenCalledTimes(1);
    first();
    second();
    guardedNavigate(action);
    expect(action).toHaveBeenCalledTimes(2);
  });
});

describe("HR draft guard", () => {
  it("passes navigation through when no form holds unsent details", () => {
    render(
      <DraftGuardProvider>
        <Draft />
      </DraftGuardProvider>,
    );
    const action = vi.fn();
    act(() => guardedNavigate(action));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the draft on Keep editing and discards it only on request", async () => {
    render(
      <DraftGuardProvider>
        <Draft />
      </DraftGuardProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Reason" });
    fireEvent.change(input, { target: { value: "Forgot to clock out" } });
    const action = vi.fn();
    act(() => guardedNavigate(action));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("not sent");
    // HR requests are sent from their own form, never from this prompt.
    expect(
      screen.queryByRole("button", { name: "Save and continue" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(action).not.toHaveBeenCalled();
    expect(input).toHaveValue("Forgot to clock out");

    act(() => guardedNavigate(action));
    fireEvent.click(
      await screen.findByRole("button", { name: "Discard changes" }),
    );
    // The guard first removes its history buffer, then navigates.
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("");
  });

  it("chains a dirty storage editor and an HR draft for programmatic navigation", async () => {
    render(
      <DraftGuardProvider>
        <StorageEditor dirty />
      </DraftGuardProvider>,
    );
    const action = vi.fn();
    act(() => guardedNavigate(action));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Save changes before leaving?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(action).not.toHaveBeenCalled();
  });

  it("blocks leaving while any HR write is pending, even with nothing typed", async () => {
    const view = render(
      <DraftGuardProvider>
        <Draft />
        <Sending pending />
      </DraftGuardProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Reason" });
    fireEvent.change(input, { target: { value: "Typed" } });
    const action = vi.fn();
    act(() => guardedNavigate(action));
    expect(await screen.findByTestId("navigation-guard-pending")).toBeVisible();
    // A pending write cannot be discarded; the typed draft is kept.
    const discard = screen.getByRole("button", { name: "Discard changes" });
    expect(discard).toBeDisabled();
    fireEvent.click(discard);
    expect(input).toHaveValue("Typed");
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    // The write settles: the remaining draft can be discarded on request.
    view.rerender(
      <DraftGuardProvider>
        <Draft />
        <Sending pending={false} />
      </DraftGuardProvider>,
    );
    act(() => guardedNavigate(action));
    expect(screen.queryByTestId("navigation-guard-pending")).toBeNull();
    fireEvent.click(
      await screen.findByRole("button", { name: "Discard changes" }),
    );
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("");
  });

  it("passes navigation once a pending-only write settles", () => {
    const view = render(
      <DraftGuardProvider>
        <Sending pending />
      </DraftGuardProvider>,
    );
    const action = vi.fn();
    act(() => guardedNavigate(action));
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    view.rerender(
      <DraftGuardProvider>
        <Sending pending={false} />
      </DraftGuardProvider>,
    );
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    act(() => guardedNavigate(action));
    expect(action).toHaveBeenCalledTimes(1);
  });
});
