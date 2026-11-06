import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  aiAvailable: true,
  canSearchPeople: true,
  open: vi.fn(),
}));

vi.mock("./GlobalSearchProvider", () => ({
  useSearchControls: () => ({
    aiAvailable: state.aiAvailable,
    canSearchPeople: state.canSearchPeople,
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
  state.canSearchPeople = true;
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
    expect(search).toHaveAccessibleName(/^Search pages or employees \(.+\)$/);
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
        expect(search).toHaveAccessibleName("Search pages or employees");
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
    expect(search).toHaveAccessibleName(/^Search pages or employees \(.+\)$/);
  });
});

describe("search trigger scope", () => {
  it.each([
    // English drops the verb beside the magnifier so ⌘K still fits; the
    // name keeps it.
    [true, "Pages or employees…", "Search pages or employees"],
    [false, "Search pages…", "Search pages"],
  ])(
    "says what search finds, like the dialog placeholder (people: %s)",
    (people, text, name) => {
      state.canSearchPeople = people;
      renderWithIntl(<Harness collapsed={false} />, { locale: "en" });
      const search = screen.getByTestId("sidebar-search");
      // The name holds the visible text; the shortcut follows it.
      expect(search).toHaveTextContent(new RegExp(`^${text}(⌘K|Ctrl K)$`));
      expect(search).toHaveAccessibleName(new RegExp(`^${name} \\(.+\\)$`));
      // Label in name: speech users can say what they see.
      expect(search.getAttribute("aria-label")!.toLowerCase()).toContain(
        text.replace("…", "").toLowerCase(),
      );
      // Warehouse records cannot be searched yet (D13): never promised.
      expect(search).not.toHaveAccessibleName(/record/i);
    },
  );

  it("says pages only in Thai when employees cannot be searched", () => {
    state.canSearchPeople = false;
    renderWithIntl(<Harness collapsed={false} />, { locale: "th" });
    const search = screen.getByTestId("sidebar-search");
    expect(search).toHaveTextContent(/^ค้นหาเมนู…/);
    expect(search).toHaveAccessibleName(/^ค้นหาเมนู \(.+\)$/);
    expect(search).not.toHaveTextContent("รายการ");
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
    expect(search).toHaveAccessibleName("ค้นหาเมนูหรือพนักงาน");
    expect(search).toHaveAttribute("aria-haspopup", "dialog");
    expect(search).toHaveClass("min-h-touch", "min-w-touch");
    expect(search.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(search);
    // Focused first, so the dialog hands focus back here when it closes.
    expect(search).toHaveFocus();
    expect(state.open.mock.calls).toEqual([["SEARCH"]]);
  });

  it("names only pages when employees cannot be searched", () => {
    state.canSearchPeople = false;
    renderHeader();
    expect(screen.getByTestId("header-search")).toHaveAccessibleName(
      "ค้นหาเมนู",
    );
  });

  it("leaves desktop search to the sidebar", () => {
    mobile = false;
    renderHeader();
    expect(screen.queryByTestId("header-search")).toBeNull();
  });
});
