import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({ aiAvailable: true, open: vi.fn() }));

vi.mock("./GlobalSearchProvider", () => ({
  useSearchControls: () => ({
    aiAvailable: state.aiAvailable,
    open: state.open,
  }),
}));

import { SidebarSearchTriggers } from "./SearchTriggers";

function Harness({
  collapsed = false,
  onOpen,
}: Parameters<typeof SidebarSearchTriggers>[0]) {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={!collapsed}>
        <SidebarSearchTriggers
          collapsed={collapsed}
          {...(onOpen === undefined ? {} : { onOpen })}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
}

beforeEach(() => {
  state.aiAvailable = true;
  state.open.mockReset();
});

describe("sidebar search triggers", () => {
  it("keeps a single search entry regardless of AI capability", () => {
    state.aiAvailable = false;
    const view = renderWithIntl(<Harness collapsed={false} />, {
      locale: "en",
      preserveProviders: true,
    });

    expect(screen.getByTestId("sidebar-search")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-ai-search")).toBeNull();
    state.aiAvailable = true;
    view.rerender(<Harness collapsed={false} />);
    expect(screen.queryByTestId("sidebar-ai-search")).toBeNull();

    state.aiAvailable = false;
    view.rerender(<Harness collapsed={false} />);
    expect(screen.queryByTestId("sidebar-ai-search")).toBeNull();
    fireEvent.click(screen.getByTestId("sidebar-search"));
    expect(state.open).toHaveBeenLastCalledWith("SEARCH");
  });

  it("lets the drawer hand off search instead of opening directly", () => {
    const handoff = vi.fn();
    renderWithIntl(<Harness collapsed={false} onOpen={handoff} />, {
      locale: "en",
    });

    fireEvent.click(screen.getByTestId("sidebar-search"));
    expect(handoff.mock.calls).toEqual([["SEARCH"]]);
    expect(state.open).not.toHaveBeenCalled();
  });

  it("keeps icon-only controls named and exposes their names as keyboard tooltips", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness collapsed />, { locale: "en" });

    const search = screen.getByTestId("sidebar-search");
    expect(search).toHaveAccessibleName(/Search pages and records \(.+\)/);
    expect(search).toHaveAttribute("aria-haspopup", "dialog");
    expect(search.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    await user.tab();
    expect(search).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      search.getAttribute("aria-label")!,
    );
    await user.keyboard("{Enter}");
    expect(state.open).toHaveBeenCalledWith("SEARCH");
  });
});
