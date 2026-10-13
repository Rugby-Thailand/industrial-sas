import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  allowed: true,
  status: "DRAFT",
  blocked: false,
  ready: true,
  version: 7,
  mutation: vi.fn(),
  query: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => {
    state.query(...args);
    // One shape answers the status, lifecycle-impact and readiness reads.
    return {
      ok: true,
      value: {
        found: true,
        status: state.status,
        version: state.version,
        blocked: state.blocked,
        ready: state.ready,
        zoneCount: 3,
        positionCount: 4,
        namedRegistrationCount: 1,
        issues: [],
      },
    };
  },
  useMutation: () => state.mutation,
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({
    permissionsReady: true,
    navigationPermissions: state.allowed
      ? ["masterData.storageLayout.activate"]
      : [],
  }),
}));
vi.mock("@/i18n/navigation", () => ({ Link: "a" }));
import { BuildingStatusToggle } from "./BuildingStatusToggle";

/** The switch opens a whole-building confirmation; confirm runs the write. */
function toggle(confirm = "Activate building") {
  fireEvent.click(screen.getByRole("switch"));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: confirm }),
  );
}

function renderToggle() {
  return renderWithIntl(
    <BuildingStatusToggle
      warehouseId="warehouse"
      buildingId="building"
      code="MAIN"
      status="DRAFT"
    />,
    { locale: "en", workspace: false },
  );
}
beforeEach(() => {
  state.query.mockReset();
  state.allowed = true;
  state.status = "DRAFT";
  state.blocked = false;
  state.ready = true;
  state.version = 7;
  state.mutation
    .mockReset()
    .mockResolvedValue({ ok: true, value: { written: true } });
});
describe("building status control", () => {
  it("submits the saved version and waits for the authoritative status", async () => {
    renderToggle();
    fireEvent.click(
      screen.getByRole("switch", { name: "Building status: MAIN" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Activate MAIN?" });
    expect(within(dialog).getByTestId("status-impact")).toHaveTextContent(
      "3 storage spots · 4 exact positions · 1 registered location",
    );
    expect(state.mutation).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Activate building" }),
    );
    await waitFor(() =>
      expect(state.mutation).toHaveBeenCalledWith(
        expect.objectContaining({
          buildingId: "building",
          warehouseId: "warehouse",
          expectedVersion: 7,
        }),
      ),
    );
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });
  it("explains the stock guard and prevents deactivation", () => {
    state.status = "ACTIVE";
    state.blocked = true;
    renderToggle();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(
      screen.queryByText(/Move or release all stock/),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Why status cannot change: MAIN" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      /Move or release all stock/,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(state.mutation).not.toHaveBeenCalled();
  });
  it("withholds activation until the server preflight passes and links to review", () => {
    state.ready = false;
    renderToggle();
    fireEvent.click(screen.getByRole("switch"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/server check found issues/);
    expect(
      within(dialog).getByRole("button", { name: "Activate building" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("link", { name: "Review and activate" }),
    ).toHaveAttribute("href", "/master-data/storage-layouts/building/review");
    expect(state.mutation).not.toHaveBeenCalled();
  });
  it("confirms a whole-building return to Draft with the affected count", async () => {
    state.status = "ACTIVE";
    renderToggle();
    fireEvent.click(screen.getByRole("switch"));
    const dialog = screen.getByRole("dialog", {
      name: "Return MAIN to Draft?",
    });
    expect(dialog).toHaveTextContent(/applies to the whole building/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(state.mutation).not.toHaveBeenCalled();
    toggle("Return building to Draft");
    await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(1));
  });
  it("keeps status read-only without activation permission", () => {
    state.allowed = false;
    renderToggle();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText(/Draft/)).toBeVisible();
  });
  it("offers setup review when activation validation fails", async () => {
    state.mutation.mockResolvedValue({
      ok: true,
      value: { written: false, error: { code: "STORAGE_STACK_REQUIRED" } },
    });
    renderToggle();
    toggle();
    expect(
      await screen.findByRole("link", { name: "Review building setup · MAIN" }),
    ).toHaveAttribute("href", "/master-data/storage-layouts/building/review");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });
  it("handles transport errors without changing the displayed state", async () => {
    state.mutation.mockRejectedValue(new Error("offline"));
    renderToggle();
    toggle();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Check your connection/,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch")).not.toBeDisabled();
  });
  it("does not route an access denial to building setup", async () => {
    state.mutation.mockResolvedValue({
      ok: false,
      denial: { code: "PERMISSION_MISSING" },
    });
    renderToggle();
    toggle();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /workspace administrator/,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it.each(["version", "building", "warehouse"])(
    "clears obsolete errors when %s changes",
    async (changed) => {
      state.mutation.mockRejectedValue(new Error("offline"));
      const view = renderToggle();
      toggle();
      await screen.findByRole("alert");
      if (changed === "version") state.version = 8;
      view.rerender(
        <NextIntlClientProvider
          locale="en"
          messages={messagesFor("en")}
          timeZone="Asia/Bangkok"
        >
          <EnvironmentProvider environment={unconfiguredEnvironment}>
            <BuildingStatusToggle
              warehouseId={
                changed === "warehouse" ? "another-warehouse" : "warehouse"
              }
              buildingId={
                changed === "building" ? "another-building" : "building"
              }
              code="MAIN"
              status="DRAFT"
            />
          </EnvironmentProvider>
        </NextIntlClientProvider>,
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );
  it("prevents repeat writes while saving", async () => {
    let finish!: (value: unknown) => void;
    state.mutation.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderToggle();
    toggle();
    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: /Saving status/,
    });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("switch", { hidden: true })).toBeDisabled();
    fireEvent.click(confirm);
    expect(state.mutation).toHaveBeenCalledTimes(1);
    finish({ ok: true, value: { written: true } });
    await waitFor(() => expect(screen.getByRole("switch")).not.toBeDisabled());
  });
});
import { EnvironmentProvider } from "@/components/providers/EnvironmentProvider";
import { unconfiguredEnvironment } from "@tests/fixtures/intl-render";
import { NextIntlClientProvider } from "next-intl";
import { messagesFor } from "@/i18n/messages";

it("uses shared occupancy controls without a second status subscription", () => {
  renderWithIntl(
    <BuildingStatusToggle
      warehouseId="warehouse"
      buildingId="building"
      code="MAIN"
      status="DRAFT"
      sharedControl={{
        loaded: true,
        value: { status: "ACTIVE", version: 9, blocked: true },
      }}
    />,
    { locale: "en", workspace: false },
  );
  expect(state.query).toHaveBeenCalledWith(expect.anything(), "skip");
  expect(screen.getByRole("switch")).toBeDisabled();
  expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
});
