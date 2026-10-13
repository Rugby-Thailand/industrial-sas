import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useWorkflowStep } from "@/hooks/useWorkflowStep";
import { trackAppHistory } from "./browser/appHistory";
import { completeTask, returnFromTask } from "./taskNavigation";

let stop: (() => void) | undefined;
afterEach(() => {
  cleanup();
  stop?.();
  stop = undefined;
});

/** The owned review and confirmation share the task's actual native stack. */
function Task({ finish }: { readonly finish: () => void }) {
  const review = useWorkflowStep("review", "task:goods-a", true);
  const confirm = useWorkflowStep("confirm", "task:goods-a", true);
  return (
    <>
      {review.active ? (
        <>
          <p>Review retained goods</p>
          {confirm.active ? (
            <button onClick={finish}>Confirm task</button>
          ) : (
            <button onClick={confirm.enter}>Confirm review</button>
          )}
        </>
      ) : (
        <button onClick={review.enter}>Review task</button>
      )}
    </>
  );
}

async function openTask(finish: () => void) {
  render(<Task finish={finish} />);
  fireEvent.click(screen.getByRole("button", { name: "Review task" }));
  await screen.findByText("Review retained goods");
  fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
  await screen.findByRole("button", { name: "Confirm task" });
}

it("returning a direct task consumes multiple native foreground entries before its fallback", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods/new?resumePalletId=pallet-a#details",
  );
  stop = trackAppHistory();
  const replace = vi.fn((href: string) =>
    window.history.replaceState({}, "", `/en${href}`),
  );
  await openTask(() => returnFromTask("/finished-goods", replace));
  expect(window.history.state.appNavigationIndex).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "Confirm task" }));
  await waitFor(() =>
    expect(window.location.pathname).toBe("/en/finished-goods"),
  );
  expect(window.history.state.appNavigationIndex).toBe(0);
  expect(window.location.search).toBe("");
  expect(replace).toHaveBeenCalledExactlyOnceWith("/finished-goods");
});

it("completion to a new task consumes native review entries and keeps the prior page for Back", async () => {
  const origin = "/th/finished-goods?search=box&tag=a&tag=b#catalogue";
  window.history.replaceState({ appNavigationIndex: 0 }, "", origin);
  stop = trackAppHistory();
  window.history.pushState({}, "", "/th/finished-goods/new#details");
  const replace = vi.fn((href: string) =>
    window.history.replaceState({ __NA: true }, "", `/th${href}`),
  );
  await openTask(() =>
    completeTask("/finished-goods/products/product-a/packing#next", replace),
  );
  expect(window.history.state.appNavigationIndex).toBe(3);
  fireEvent.click(screen.getByRole("button", { name: "Confirm task" }));
  await waitFor(() =>
    expect(window.location.pathname).toBe(
      "/th/finished-goods/products/product-a/packing",
    ),
  );
  expect(window.history.state.appNavigationIndex).toBe(1);
  expect(window.location.search).toBe("");
  expect(window.location.hash).toBe("#next");
  window.history.back();
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(origin),
  );
  expect(window.history.state.appNavigationIndex).toBe(0);
});

it("completion back to the source consumes both foregrounds and restores its query/hash", async () => {
  const origin = "/en/finished-goods?search=box&tag=a&tag=b#catalogue";
  window.history.replaceState({ appNavigationIndex: 0 }, "", origin);
  stop = trackAppHistory();
  window.history.pushState({}, "", "/en/finished-goods/new#details");
  const replace = vi.fn();
  await openTask(() => completeTask("/finished-goods", replace));
  fireEvent.click(screen.getByRole("button", { name: "Confirm task" }));
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(origin),
  );
  expect(window.history.state.appNavigationIndex).toBe(0);
  expect(replace).not.toHaveBeenCalled();
});
