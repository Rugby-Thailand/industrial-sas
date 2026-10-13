import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { guardedNavigate } from "@/lib/navigationGuard";
import { useDraftGuard } from "@/components/providers/draftGuard";

const state = vi.hoisted(() => ({
  theme: "light",
  setTheme: vi.fn(),
  workspace: {} as Record<string, unknown>,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: state.theme, setTheme: state.setTheme }),
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => state.workspace,
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceContextBar } from "./WorkspaceContextBar";

const warehouses = [
  { id: "wh-1", code: "TG-OPT", name: "Top Gold Optimized Warehouse" },
  { id: "wh-2", code: "TG-B", name: "Second" },
];
const ready = (overrides: Record<string, unknown> = {}) => ({
  selectable: true,
  organization: { id: "org", name: "Top Gold" },
  warehouses,
  selectedWarehouseId: "wh-1",
  selectWarehouse: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  state.theme = "light";
  state.setTheme.mockReset();
  state.workspace = ready();
});

describe("ThemeToggle", () => {
  it("is one compact icon toggle button that switches theme", () => {
    renderWithIntl(<ThemeToggle />, { locale: "en" });
    const button = screen.getByRole("button", { name: "Dark theme" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("title", "Switch to dark theme");
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(button);
    expect(state.setTheme).toHaveBeenCalledWith("dark");
  });

  it("reports dark as pressed and switches back to light, in Thai too", () => {
    state.theme = "dark";
    renderWithIntl(<ThemeToggle />, { locale: "th" });
    const button = screen.getByRole("button", { name: "ธีมมืด" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("title", "เปลี่ยนเป็นธีมสว่าง");
    fireEvent.click(button);
    expect(state.setTheme).toHaveBeenCalledWith("light");
  });
});

function OpenState() {
  return <output data-testid="sidebar-state">{useSidebar().state}</output>;
}

describe("WorkspaceContextBar in the sidebar", () => {
  const render = (props: { switchable: boolean; collapsed?: boolean }) =>
    renderWithIntl(
      <TooltipProvider>
        <SidebarProvider defaultOpen={false}>
          <WorkspaceContextBar {...props} />
          <OpenState />
        </SidebarProvider>
      </TooltipProvider>,
      { locale: "en" },
    );

  it("offers warehouse switching on switchable pages", () => {
    render({ switchable: true });
    expect(screen.getByTestId("warehouse-select")).toHaveTextContent("TG-OPT");
    expect(
      screen.getByRole("combobox", { name: "Warehouse" }),
    ).toBeInTheDocument();
  });

  it("shows the selected code read-only elsewhere, naming the warehouse for assistive technology", () => {
    render({ switchable: false });
    expect(screen.queryByTestId("warehouse-select")).toBeNull();
    expect(screen.getByText("TG-OPT")).toBeVisible();
    expect(screen.getByText("Top Gold Optimized Warehouse")).toHaveClass(
      "sr-only",
    );
  });

  it("shows nothing read-only without a selection or storage access", () => {
    state.workspace = ready({ selectable: false, organization: undefined });
    render({ switchable: false });
    expect(screen.queryByTestId("sidebar-warehouse")).toBeNull();
    expect(screen.queryByTestId("sidebar-warehouse-rail")).toBeNull();
  });

  it("keeps the unavailable explanation where switching belongs", () => {
    state.workspace = ready({ selectable: false, organization: undefined });
    render({ switchable: true });
    expect(screen.getByText("No organization context")).toBeVisible();
    expect(screen.queryByTestId("warehouse-select")).toBeNull();
  });

  it("asks before a warehouse switch discards unsaved work", async () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    const committed = vi.fn();
    const workspace = ready({
      selectWarehouse: vi.fn((id: string) =>
        guardedNavigate(() => committed(id)),
      ),
    });
    state.workspace = workspace;
    function UnsavedDraft() {
      useDraftGuard(true, () => undefined);
      return null;
    }
    renderWithIntl(
      <NavigationGuardProvider>
        <TooltipProvider>
          <SidebarProvider defaultOpen>
            <UnsavedDraft />
            <WorkspaceContextBar switchable />
          </SidebarProvider>
        </TooltipProvider>
      </NavigationGuardProvider>,
      { locale: "en" },
    );
    const user = userEvent.setup();
    const choose = async () => {
      await user.click(screen.getByRole("combobox", { name: "Warehouse" }));
      await user.click(screen.getByRole("option", { name: /TG-B/ }));
    };
    await choose();
    expect(
      screen.getByRole("dialog", { name: "Save changes before leaving?" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(committed).not.toHaveBeenCalled();
    await choose();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    act(() => {
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: window.history.state }),
      );
    });
    expect(committed).toHaveBeenCalledExactlyOnceWith("wh-2");
    vi.mocked(window.history.back).mockRestore();
  });

  it("collapses to one rail icon that opens the sidebar", () => {
    render({ switchable: true, collapsed: true });
    const rail = screen.getByRole("button", {
      name: "Warehouse: TG-OPT · Top Gold Optimized Warehouse",
    });
    expect(screen.getByTestId("sidebar-state")).toHaveTextContent("collapsed");
    fireEvent.click(rail);
    expect(screen.getByTestId("sidebar-state")).toHaveTextContent("expanded");
  });

  it("shows the full selection as a title on the compact selector", () => {
    render({ switchable: true });
    expect(screen.getByTestId("sidebar-warehouse")).toHaveAttribute(
      "title",
      "TG-OPT · Top Gold Optimized Warehouse",
    );
  });
});

/** Mirrors the shell: the rail when collapsed, the compact identity otherwise. */
function ResponsiveBar({ switchable }: { readonly switchable: boolean }) {
  const collapsed = useSidebar().state === "collapsed";
  return <WorkspaceContextBar switchable={switchable} collapsed={collapsed} />;
}

describe("WorkspaceContextBar rail expansion", () => {
  const render = (switchable: boolean) =>
    renderWithIntl(
      <TooltipProvider>
        <SidebarProvider defaultOpen={false}>
          <ResponsiveBar switchable={switchable} />
        </SidebarProvider>
      </TooltipProvider>,
      { locale: "en" },
    );

  it("moves focus from the unmounting rail button to the warehouse selector", () => {
    render(true);
    const rail = screen.getByTestId("sidebar-warehouse-rail");
    rail.focus();
    fireEvent.click(rail);
    expect(rail).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Warehouse" })).toHaveFocus();
  });

  it("focuses the read-only warehouse when it cannot be switched", () => {
    render(false);
    fireEvent.click(screen.getByTestId("sidebar-warehouse-rail"));
    expect(screen.getByRole("region", { name: "Warehouse" })).toHaveFocus();
  });
});
