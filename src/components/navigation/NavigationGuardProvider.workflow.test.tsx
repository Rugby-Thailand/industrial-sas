import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useWorkflowStep } from "@/hooks/useWorkflowStep";
import { trackAppHistory } from "@/lib/browser/appHistory";
import {
  NavigationGuardProvider,
  useNavigationDraft,
} from "./NavigationGuardProvider";

const ORIGIN = "/en/finished-goods?search=DEMO#origin";
const QUESTION = "/en/finished-goods/scan?qa=draft#tickets";
const SCOPE = "job-scan:test";
let stopTracking: () => void;

function ScanWorkflow({
  pending = false,
  initialTicket = "",
}: {
  pending?: boolean;
  initialTicket?: string;
}) {
  const [ticket, setTicket] = useState(initialTicket);
  const step = useWorkflowStep("jobScanStep", SCOPE, true);
  useNavigationDraft({
    dirty: ticket !== "",
    pending,
    workflowScope: SCOPE,
    discard: () => setTicket(""),
  });
  return (
    <>
      <output aria-label="Step">
        {step.active ? "Tickets" : "Location question"}
      </output>
      <input
        aria-label="Ticket"
        value={ticket}
        onChange={(event) => setTicket(event.target.value)}
      />
      <button onClick={() => step.enter()}>Open tickets</button>
      <button onClick={() => step.back()}>Header Back</button>
    </>
  );
}

function view(pending = false, initialTicket = "") {
  return (
    <NavigationGuardProvider>
      <ScanWorkflow pending={pending} initialTicket={initialTicket} />
    </NavigationGuardProvider>
  );
}

beforeEach(() => {
  window.history.replaceState(
    { __NA: true, appNavigationIndex: 0 },
    "",
    ORIGIN,
  );
  stopTracking = trackAppHistory();
  window.history.pushState({ __NA: true }, "", QUESTION);
});
afterEach(() => {
  cleanup();
  stopTracking();
  vi.restoreAllMocks();
});

async function backToQuestion(header = false) {
  fireEvent.click(screen.getByRole("button", { name: "Open tickets" }));
  fireEvent.change(screen.getByLabelText("Ticket"), {
    target: { value: "FO99990001" },
  });
  if (header)
    fireEvent.click(screen.getByRole("button", { name: "Header Back" }));
  else act(() => window.history.back());
  await waitFor(() =>
    expect(screen.getByLabelText("Step")).toHaveTextContent(
      "Location question",
    ),
  );
  expect(window.location.search + window.location.hash).toBe(
    "?qa=draft#tickets",
  );
  expect(screen.getByLabelText("Ticket")).toHaveValue("FO99990001");
}

describe("retained workflow history with the real navigation guard", () => {
  it.each([false, true])(
    "restores retained tickets with Forward after Back (header=%s) without losing exit protection",
    async (header) => {
      render(view());
      await backToQuestion(header);
      act(() => window.history.forward());
      await waitFor(() =>
        expect(screen.getByLabelText("Step")).toHaveTextContent("Tickets"),
      );
      expect(screen.getByLabelText("Ticket")).toHaveValue("FO99990001");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      act(() => window.history.back());
      await waitFor(() =>
        expect(screen.getByLabelText("Step")).toHaveTextContent(
          "Location question",
        ),
      );
      act(() => window.history.back());
      await screen.findByRole("dialog");
      await waitFor(() =>
        expect(
          window.location.pathname +
            window.location.search +
            window.location.hash,
        ).toBe(QUESTION),
      );
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      act(() => window.history.back());
      await screen.findByRole("dialog");
      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
      await waitFor(() =>
        expect(
          window.location.pathname +
            window.location.search +
            window.location.hash,
        ).toBe(ORIGIN),
      );
    },
  );
  it("keeps Forward and dirty protection after a retained workflow owner remount", async () => {
    const mounted = render(view());
    await backToQuestion();
    mounted.unmount();
    render(view(false, "FO99990001"));
    act(() => window.history.forward());
    await waitFor(() =>
      expect(screen.getByLabelText("Step")).toHaveTextContent("Tickets"),
    );
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.getByLabelText("Step")).toHaveTextContent(
        "Location question",
      ),
    );
    act(() => window.history.back());
    await screen.findByRole("dialog");
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe(QUESTION),
    );
    expect(screen.getByLabelText("Ticket")).toHaveValue("FO99990001");
  });

  it("blocks Forward while a retained write is pending and restores it after Keep and completion", async () => {
    const mounted = render(view());
    await backToQuestion();
    mounted.rerender(view(true));
    act(() => window.history.forward());
    await screen.findByRole("dialog");
    await waitFor(() => expect(window.location.search).toBe("?qa=draft"));
    expect(
      screen.getByRole("button", { name: "Discard changes" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Step")).toHaveTextContent(
      "Location question",
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    mounted.rerender(view(false));
    act(() => window.history.forward());
    await waitFor(() =>
      expect(screen.getByLabelText("Step")).toHaveTextContent("Tickets"),
    );
    expect(screen.getByLabelText("Ticket")).toHaveValue("FO99990001");
  });

  it("pushes a new workflow entry from the retained predecessor instead of replacing it", async () => {
    render(view());
    await backToQuestion();
    fireEvent.click(screen.getByRole("button", { name: "Open tickets" }));
    expect(screen.getByLabelText("Step")).toHaveTextContent("Tickets");
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.getByLabelText("Step")).toHaveTextContent(
        "Location question",
      ),
    );
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(QUESTION);
    act(() => window.history.forward());
    await waitFor(() =>
      expect(screen.getByLabelText("Step")).toHaveTextContent("Tickets"),
    );
  });

  it("reconciles the old duplicate farther Forward before the next native Back", async () => {
    render(view());
    await backToQuestion();
    act(() => window.history.forward());
    await waitFor(() =>
      expect(screen.getByLabelText("Step")).toHaveTextContent("Tickets"),
    );
    const anchor = window.history.state.__storageWorkspaceGuard;
    act(() => window.history.forward());
    await waitFor(() =>
      expect(window.history.state.__storageWorkspaceGuard).not.toBe(anchor),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.getByLabelText("Step")).toHaveTextContent(
        "Location question",
      ),
    );
    expect(screen.getByLabelText("Ticket")).toHaveValue("FO99990001");
  });

  it("clears a clean remount's anchor without consuming its predecessor or Forward", async () => {
    const mounted = render(view());
    await backToQuestion();
    mounted.unmount();
    render(view());
    expect(window.history.state.__storageWorkspaceGuard).toBeUndefined();
    act(() => window.history.forward());
    await waitFor(() =>
      expect(screen.getByLabelText("Step")).toHaveTextContent("Tickets"),
    );
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.getByLabelText("Step")).toHaveTextContent(
        "Location question",
      ),
    );
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe(ORIGIN),
    );
  });
});
