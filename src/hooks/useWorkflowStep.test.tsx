import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { updateBrowserQuery } from "@/lib/browser/history";
import { useWorkflowStep } from "./useWorkflowStep";

it("keeps the latest query and hash when an invalidated foreground's native Back is delayed", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/th/finished-goods/scan/records?source=keep#original",
  );
  const stop = trackAppHistory();
  const view = renderHook(
    ({ available }) => useWorkflowStep("picker", "records:scope", available),
    { initialProps: { available: true } },
  );
  const nativeBack = window.history.back.bind(window.history);
  const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  try {
    act(() => view.result.current.enter());
    expect(view.result.current.active).toBe(true);
    act(() => updateBrowserQuery((query) => query.set("search", "F")));
    view.rerender({ available: false });
    await waitFor(() => expect(back).toHaveBeenCalledOnce());
    act(() =>
      updateBrowserQuery((query) => query.set("search", "FO00"), {
        hash: "#latest",
      }),
    );
    act(() => nativeBack());
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).has("picker")).toBe(
        false,
      ),
    );
    expect(window.location.pathname).toBe("/th/finished-goods/scan/records");
    expect(new URLSearchParams(window.location.search).get("search")).toBe(
      "FO00",
    );
    expect(new URLSearchParams(window.location.search).get("source")).toBe(
      "keep",
    );
    expect(window.location.hash).toBe("#latest");
    expect(window.history.state.appNavigationIndex).toBe(0);
  } finally {
    view.unmount();
    back.mockRestore();
    stop();
  }
});
