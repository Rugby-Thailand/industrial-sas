import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { HeaderSearchTrigger, SidebarSearchTriggers } from "./SearchTriggers";

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

describe("sidebar search trigger on phones and touch screens", () => {
  it.each(["(pointer: coarse)", "(max-width: 1023px)"])(
    "drops the keyboard shortcut when %s matches",
    (matching) => {
      const original = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        ...original(query),
        matches: query === matching,
      })) as typeof window.matchMedia;
      try {
        renderWithIntl(<Harness collapsed={false} />, { locale: "en" });
        const search = screen.getByTestId("sidebar-search");
        expect(search.querySelector("kbd")).toBeNull();
        expect(search).toHaveAccessibleName("Search pages and records");
        fireEvent.click(search);
        expect(state.open).toHaveBeenCalledWith("SEARCH");
      } finally {
        window.matchMedia = original;
      }
    },
  );

  it("keeps the shortcut on a desktop with a precise pointer", () => {
    renderWithIntl(<Harness collapsed={false} />, { locale: "en" });
    const search = screen.getByTestId("sidebar-search");
    expect(search.querySelector("kbd")).toHaveTextContent(/⌘K|Ctrl K/);
    expect(search).toHaveAccessibleName(/Search pages and records \(.+\)/);
  });
});

describe("header search trigger", () => {
  const original = window.matchMedia;
  let mobile = true;
  beforeEach(() => {
    mobile = true;
    window.matchMedia = ((query: string) => ({
      ...original(query),
      matches: mobile && query.includes("width"),
    })) as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
  });
  const renderHeader = () =>
    renderWithIntl(
      <SidebarProvider>
        <HeaderSearchTrigger />
      </SidebarProvider>,
      { locale: "th" },
    );

  it("puts a named 48 px search button in the phone header that opens normal search", () => {
    renderHeader();
    const search = screen.getByTestId("header-search");
    // No keyboard shortcut on a phone; the Thai name says what it finds.
    expect(search).toHaveAccessibleName("ค้นหาหน้าและรายการ");
    expect(search).toHaveAttribute("aria-haspopup", "dialog");
    expect(search).toHaveClass("min-h-touch", "min-w-touch");
    expect(search.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(search);
    // Focused first, so the dialog hands focus back here when it closes.
    expect(search).toHaveFocus();
    expect(state.open.mock.calls).toEqual([["SEARCH"]]);
  });

  it("leaves desktop search to the sidebar", () => {
    mobile = false;
    renderHeader();
    expect(screen.queryByTestId("header-search")).toBeNull();
  });
});
