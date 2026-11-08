import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { storageLayoutRefs } from "@/lib/convex/storageLayoutApi";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { PageBackButton } from "@/components/ui/PageBackButton";
import { BuildingStatusToggle } from "./BuildingStatusToggle";

const state = vi.hoisted(() => ({
  status: "DRAFT" as "DRAFT" | "ACTIVE",
  version: 7,
  writes: [] as { ref: unknown; args: Record<string, unknown> }[],
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    if (ref === storageLayoutRefs.statusControl)
      return {
        ok: true,
        value: { status: state.status, version: state.version, blocked: false },
      };
    if (ref === storageLayoutRefs.readiness)
      return {
        ok: true,
        value: { found: true, ready: true, version: state.version, issues: [] },
      };
    if (ref === storageLayoutRefs.lifecycleImpact)
      return {
        ok: true,
        value: {
          found: true,
          complete: true,
          zoneCount: 1,
          positionCount: 1,
          namedRegistrationCount: 0,
          capacityExceeded: false,
          canArchive: true,
        },
      };
    throw new Error("Unexpected query");
  },
  useMutation: (ref: unknown) => async (args: Record<string, unknown>) => {
    state.writes.push({ ref, args });
    return { ok: true, value: { written: true } };
  },
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({
    permissionsReady: true,
    navigationPermissions: ["masterData.storageLayout.activate"],
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: "a",
  useRouter: () => ({ push: vi.fn() }),
}));

beforeEach(() => {
  state.status = "DRAFT";
  state.version = 7;
  state.writes = [];
});
afterEach(cleanup);

it.each([false, true])(
  "reviewed Activate cannot become Draft when all live props refresh (shared=%s)",
  async (shared) => {
    const toggle = () => (
      <BuildingStatusToggle
        warehouseId="warehouse"
        buildingId="building"
        code="MAIN"
        status={state.status}
        {...(shared
          ? {
              sharedControl: {
                loaded: true,
                value: {
                  status: state.status,
                  version: state.version,
                  blocked: false,
                },
              },
            }
          : {})}
      />
    );
    const view = renderWithIntl(toggle(), {
      locale: "en",
      workspace: false,
      preserveProviders: true,
    });
    fireEvent.click(
      screen.getByRole("switch", { name: "Building status: MAIN" }),
    );
    const button = within(
      screen.getByRole("dialog", { name: "Activate MAIN?" }),
    ).getByRole("button", { name: "Activate building" });
    expect(button).toBeEnabled();
    state.status = "ACTIVE";
    state.version = 8;
    view.rerender(toggle());
    // Live updates must preserve the reviewed command and refuse its stale version.
    expect(screen.getByRole("button", { name: "Activate building" })).toBe(
      button,
    );
    expect(button).toBeDisabled();
    // The reason shown is the concurrent change, not a failed readiness check.
    expect(
      screen.getByText(
        "The layout changed while you were editing. Refresh to review the latest version, then try again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "The server check found issues. Open the review to fix them before activation.",
      ),
    ).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(button);
    });
    expect({
      draftWrites: state.writes.filter(
        (write) => write.ref === storageLayoutRefs.returnToDraft,
      ).length,
      versions: state.writes.map((write) => write.args.expectedVersion),
    }).toEqual({ draftWrites: 0, versions: [] });
  },
);

it.each(["DRAFT", "ACTIVE"] as const)(
  "refuses a reviewed %s command after only the version changes",
  async (status) => {
    state.status = status;
    const toggle = (
      <BuildingStatusToggle
        warehouseId="warehouse"
        buildingId="building"
        code="MAIN"
        status={status}
      />
    );
    const view = renderWithIntl(toggle, {
      locale: "en",
      workspace: false,
      preserveProviders: true,
    });
    fireEvent.click(screen.getByRole("switch"));
    const button = within(screen.getByRole("dialog")).getByRole("button", {
      name:
        status === "ACTIVE" ? "Return building to Draft" : "Activate building",
    });
    expect(button).toBeEnabled();
    state.version = 8;
    view.rerender(
      <BuildingStatusToggle
        warehouseId="warehouse"
        buildingId="building"
        code="MAIN"
        status={status}
      />,
    );
    expect(button).toBeDisabled();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(state.writes).toHaveLength(0);
  },
);

it.each(["Cancel", "native Back", "header Back"])(
  "%s dismisses a stale status review before the next Back restores the actual origin",
  async (dismiss) => {
    window.history.replaceState(
      null,
      "",
      "/th/finished-goods?origin=1#records",
    );
    const releaseHistory = trackAppHistory();
    try {
      window.history.pushState(
        null,
        "",
        "/th/master-data/storage-layouts?view=all#buildings",
      );
      const toggle = () => (
        <>
          <PageBackButton fallbackHref={null} />
          <BuildingStatusToggle
            warehouseId="warehouse"
            buildingId="building"
            code="MAIN"
            status={state.status}
          />
        </>
      );
      const view = renderWithIntl(toggle(), {
        locale: "en",
        workspace: false,
        preserveProviders: true,
      });
      fireEvent.click(screen.getByRole("switch"));
      state.status = "ACTIVE";
      state.version = 8;
      view.rerender(toggle());
      expect(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Activate building",
        }),
      ).toBeDisabled();
      if (dismiss === "Cancel") {
        fireEvent.click(
          within(screen.getByRole("dialog")).getByRole("button", {
            name: "Cancel",
          }),
        );
      } else if (dismiss === "header Back") {
        fireEvent.click(
          screen.getByRole("button", { name: "Back", hidden: true }),
        );
      } else {
        act(() => window.history.back());
      }
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(
          window.location.pathname +
            window.location.search +
            window.location.hash,
        ).toBe("/th/master-data/storage-layouts?view=all#buildings"),
      );
      act(() => window.history.back());
      await waitFor(() =>
        expect(
          window.location.pathname +
            window.location.search +
            window.location.hash,
        ).toBe("/th/finished-goods?origin=1#records"),
      );
      expect(state.writes).toHaveLength(0);
    } finally {
      releaseHistory();
    }
  },
);

it("Forward reopens a status confirmation for a fresh review after native Back", async () => {
  window.history.replaceState(
    null,
    "",
    "/en/master-data/storage-layouts?view=all#buildings",
  );
  const releaseHistory = trackAppHistory();
  try {
    const toggle = () => (
      <BuildingStatusToggle
        warehouseId="warehouse"
        buildingId="building"
        code="MAIN"
        status={state.status}
      />
    );
    const view = renderWithIntl(toggle(), {
      locale: "en",
      workspace: false,
      preserveProviders: true,
    });
    fireEvent.click(screen.getByRole("switch"));
    expect(
      screen.getByRole("dialog", { name: "Activate MAIN?" }),
    ).toBeVisible();
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    state.status = "ACTIVE";
    state.version = 8;
    view.rerender(toggle());
    act(() => window.history.forward());
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Return MAIN to Draft?" }),
      ).toBeVisible(),
    );
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Return building to Draft",
      }),
    ).toBeEnabled();
    expect(state.writes).toHaveLength(0);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/en/master-data/storage-layouts?view=all#buildings"),
    );
  } finally {
    releaseHistory();
  }
});
