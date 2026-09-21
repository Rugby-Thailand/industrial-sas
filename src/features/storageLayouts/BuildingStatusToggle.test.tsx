import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  allowed: true,
  status: "DRAFT",
  blocked: false,
  version: 7,
  mutation: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: () => ({
    ok: true,
    value: {
      status: state.status,
      version: state.version,
      blocked: state.blocked,
    },
  }),
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
  state.allowed = true;
  state.status = "DRAFT";
  state.blocked = false;
  state.version = 7;
  state.mutation
    .mockReset()
    .mockResolvedValue({ ok: true, value: { written: true } });
});
describe("building status control", () => {
  it("submits the saved version and waits for the authoritative status", async () => {
    renderToggle();
    fireEvent.click(
      screen.getByRole("switch", { name: "Active building: MAIN" }),
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
    fireEvent.click(screen.getByRole("switch"));
    expect(
      await screen.findByRole("link", { name: "Review building setup · MAIN" }),
    ).toHaveAttribute("href", "/master-data/storage-layouts/building/review");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });
  it("handles transport errors without changing the displayed state", async () => {
    state.mutation.mockRejectedValue(new Error("offline"));
    renderToggle();
    fireEvent.click(screen.getByRole("switch"));
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
    fireEvent.click(screen.getByRole("switch"));
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
      fireEvent.click(screen.getByRole("switch"));
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
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Saving status");
    fireEvent.click(screen.getByRole("switch"));
    expect(state.mutation).toHaveBeenCalledTimes(1);
    finish({ ok: true, value: { written: true } });
    await waitFor(() => expect(screen.getByRole("switch")).not.toBeDisabled());
  });
});
import { EnvironmentProvider } from "@/components/providers/EnvironmentProvider";
import { unconfiguredEnvironment } from "@tests/fixtures/intl-render";
import { NextIntlClientProvider } from "next-intl";
import { messagesFor } from "@/i18n/messages";
