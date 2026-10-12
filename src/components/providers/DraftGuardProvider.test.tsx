import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routing = vi.hoisted(() => ({ router: { push: vi.fn() }, locale: "en" }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => routing.router }));
vi.mock("next-intl", () => ({ useLocale: () => routing.locale }));

import { useNavigationDraft } from "@/components/navigation/NavigationGuardProvider";
import { guardedNavigate } from "@/lib/navigationGuard";

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
  useNavigationDraft({
    dirty,
    pending: false,
    save: async () => true,
    discard: () => undefined,
  });
  return null;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/en/hr/review");
});
afterEach(() => vi.clearAllMocks());

describe("navigation guard bridge", () => {
  it("runs a navigation directly when no shell owner is mounted", () => {
    const action = vi.fn();
    guardedNavigate(action);
    expect(action).toHaveBeenCalledOnce();
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

  it("asks once for a dirty storage editor and an HR draft together", async () => {
    render(
      <DraftGuardProvider>
        <StorageEditor dirty />
        <Draft />
      </DraftGuardProvider>,
    );
    const action = vi.fn();
    act(() => guardedNavigate(action));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Save changes before leaving?",
    );
    // Only the storage editor can save, and it is the sole dirty draft.
    expect(
      screen.getByRole("button", { name: "Save and continue" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
      target: { value: "Typed" },
    });
    act(() => guardedNavigate(action));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    // Two dirty drafts: saving one would silently lose the other.
    expect(
      screen.queryByRole("button", { name: "Save and continue" }),
    ).not.toBeInTheDocument();
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
