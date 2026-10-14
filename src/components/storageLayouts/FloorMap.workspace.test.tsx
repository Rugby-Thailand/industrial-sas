import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { FloorMap } from "./FloorMap";
import { floorMapDemo } from "./storageFloorDemoData";
vi.mock("@/hooks/useCanManage", () => ({ useCanManage: () => false }));
vi.mock("@/i18n/navigation", () => ({ Link: "a" }));
beforeEach(() => {
  window.history.replaceState(
    { custom: "retained" },
    "",
    "/planner?floor=2&view=storage#floor",
  );
  localStorage.clear();
});
const show = () =>
  renderWithIntl(<FloorMap {...floorMapDemo(false, false)} />, {
    locale: "en",
    workspace: false,
  });
describe("canvas first workspace", () => {
  it("defaults to map, preserves query context and uses keyboard view controls", () => {
    show();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    const map = screen.getByRole("button", { name: "Map view" });
    fireEvent.keyDown(map, { key: "ArrowRight" });
    expect(screen.getByRole("table")).toBeVisible();
    expect(window.location.search).toBe("?floor=2&view=storage&panel=list");
    expect(window.location.hash).toBe("#floor");
    expect(window.history.state.custom).toBe("retained");
    fireEvent.click(screen.getByRole("button", { name: "Split view" }));
    expect(
      screen.getByRole("group", { name: "Interactive floor map" }),
    ).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    fireEvent.click(map);
    expect(new URLSearchParams(window.location.search).has("panel")).toBe(
      false,
    );
  });
  it("retains camera and selection between panels, and hides details without deselecting", () => {
    const view = show();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    fireEvent.click(
      within(screen.getByRole("table")).getAllByRole("button", {
        name: /Select location/,
      })[0]!,
    );
    const selected = view.container
      .querySelector('tr[data-state="selected"] button')
      ?.getAttribute("aria-label");
    expect(
      view.container.querySelector("[data-inline-location-details]"),
    ).not.toBeNull();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show on map" }));
    expect(
      view.container.querySelector('[data-map-zone-id][aria-pressed="true"]'),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByText(/125%/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(
      view.container.querySelector('tr[data-state="selected"] button'),
    ).toHaveAttribute("aria-label", selected);
  });
  it("changes views and reopens details without submitting an editor form", () => {
    const submit = vi.fn();
    renderWithIntl(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <FloorMap {...floorMapDemo(false, false)} />
      </form>,
      { locale: "en", workspace: false },
    );
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    fireEvent.click(
      within(screen.getByRole("table")).getAllByRole("button", {
        name: /Select location/,
      })[0]!,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show on map" }));
    expect(screen.getByRole("button", { name: "Map view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    fireEvent.click(
      screen.getByRole("button", { name: / · Location details$/ }),
    );
    expect(screen.getByRole("complementary")).toBeVisible();
    expect(submit).not.toHaveBeenCalled();
  });
  it("shares status filters and search across map and table without opening an inspector", () => {
    const view = show();
    fireEvent.click(screen.getByRole("button", { name: "Filter locations" }));
    fireEvent.click(screen.getByRole("button", { name: "Empty" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Empty" }), {
      key: "Escape",
    });
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      2,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "no-such-location" },
    });
    expect(screen.getByText("No storage locations match")).toBeVisible();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Map view" }));
    expect(view.container.querySelector("[data-map-zone-id]")).toHaveAttribute(
      "opacity",
      "0.3",
    );
  });
  it("gives built-in desktop details one close and keeps the selection when hidden", () => {
    const demo = floorMapDemo(false, false);
    const view = renderWithIntl(
      <FloorMap
        {...demo}
        blocks={[
          ...demo.blocks,
          {
            xMm: 1000,
            yMm: 16000,
            widthMm: 3000,
            depthMm: 1500,
            label: "Quarantine",
          },
        ]}
      />,
      { locale: "en", workspace: false },
    );
    const closes = (scope: HTMLElement) =>
      within(scope).queryAllByRole("button", {
        name: /^(Hide details|Clear selection|Close dialog)$/,
      });
    const cell = screen.getByRole("button", {
      name: "Select location FG-A · Full footprint",
    });
    fireEvent.click(cell);
    let aside = screen.getByRole("complementary", {
      name: "Selected location",
    });
    expect(
      within(aside).getByRole("heading", { name: "FG-A · Full footprint" }),
    ).toBeVisible();
    expect(closes(aside)).toHaveLength(1);
    expect(closes(aside)[0]).toHaveAccessibleName("Hide details");
    fireEvent.click(closes(aside)[0]!);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(cell).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "DEMO-Z01 · Location details" }),
    );
    expect(closes(screen.getByRole("complementary"))).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Select area Quarantine" }),
    );
    aside = screen.getByRole("complementary", { name: "Selected location" });
    expect(view.container.querySelector("[data-selected-area]")).not.toBeNull();
    expect(closes(aside)).toHaveLength(1);
    expect(closes(aside)[0]).toHaveAccessibleName("Hide details");
  });
  it("gives the built-in compact sheet one close and reopens the same selection", async () => {
    const original = window.matchMedia;
    const spy = vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...original(query),
      matches: query === "(max-width: 850px)",
    }));
    try {
      show();
      const cell = screen.getByRole("button", {
        name: "Select location FG-B · Stored & reserved",
      });
      fireEvent.click(cell);
      const sheet = screen.getByRole("dialog", { name: "Location details" });
      expect(
        within(sheet).getByRole("heading", {
          name: "FG-B · Stored & reserved",
        }),
      ).toBeVisible();
      expect(
        within(sheet).queryByRole("button", { name: "Clear selection" }),
      ).toBeNull();
      expect(
        within(sheet).getAllByRole("button", { name: "Close dialog" }),
      ).toHaveLength(1);
      fireEvent.click(
        within(sheet).getByRole("button", { name: "Close dialog" }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(cell).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(
        screen.getByRole("button", { name: "DEMO-Z02 · Location details" }),
      );
      expect(
        screen.getByRole("dialog", { name: "Location details" }),
      ).toBeVisible();
    } finally {
      spy.mockRestore();
    }
  });
  it("lets the built-in inline table drawer clear the selection", () => {
    const view = show();
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    fireEvent.click(
      within(screen.getByRole("table")).getAllByRole("button", {
        name: /Select location/,
      })[0]!,
    );
    const drawer = view.container.querySelector<HTMLElement>(
      "[data-inline-location-details]",
    )!;
    const clear = within(drawer).getAllByRole("button", {
      name: "Clear selection",
    });
    expect(clear).toHaveLength(1);
    // The action sits beside the drawer heading, not inside the details body.
    const header = within(drawer).getByRole("heading", {
      name: "Location details",
    }).parentElement!;
    expect(within(header).getAllByRole("button")).toEqual(clear);
    fireEvent.click(clear[0]!);
    expect(
      view.container.querySelector("[data-inline-location-details]"),
    ).toBeNull();
    expect(
      view.container.querySelector('tr[data-state="selected"]'),
    ).toBeNull();
  });
  it("returns focus to the search field after clearing it", () => {
    show();
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "FG" } });
    const clear = screen.getByRole("button", { name: "Clear search" });
    clear.focus();
    fireEvent.click(clear);
    expect(search).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: "Clear search" }),
    ).not.toBeInTheDocument();
    expect(search).toHaveFocus();
  });
});

describe("phone workspace (≤580px)", () => {
  const phone = () => {
    const original = window.matchMedia;
    return vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...original(query),
      // Every max-width breakpoint at or above the phone width matches.
      matches: /max-width: (\d+)px/.test(query)
        ? Number(/max-width: (\d+)px/.exec(query)![1]) >= 580
        : false,
    }));
  };
  const stagingArea = {
    xMm: 1000,
    yMm: 16000,
    widthMm: 2800,
    depthMm: 8980,
    label: "Staging · 1 · 2.80 × 8.98 m",
  };
  const showPhone = () => {
    const demo = floorMapDemo(false, false);
    return renderWithIntl(
      <FloorMap {...demo} blocks={[...demo.blocks, stagingArea]} />,
      { locale: "en", workspace: false },
    );
  };
  const closeSheet = async () => {
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Location details" }),
      ).getByRole("button", { name: "Close dialog" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  };

  it("shows a reserved area once in the sheet and reopens it on a second tap", async () => {
    const spy = phone();
    try {
      showPhone();
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      expect(screen.getByText(/125%/)).toBeVisible();
      const area = screen.getByRole("button", {
        name: `Select area ${stagingArea.label}`,
      });
      fireEvent.click(area);
      let sheet = screen.getByRole("dialog", { name: "Location details" });
      // The description names the area without repeating its dimensions,
      // which stay in their own row; there is no heading or inner clear.
      expect(sheet).toHaveAccessibleDescription(/^Staging · 1 · Floor \d+$/);
      expect(within(sheet).queryByRole("heading", { level: 3 })).toBeNull();
      expect(within(sheet).getByText("2.8 × 8.98 m")).toBeVisible();
      expect(
        within(sheet).queryByRole("button", { name: "Clear selection" }),
      ).toBeNull();
      expect(
        within(sheet).getAllByRole("button", { name: "Close dialog" }),
      ).toHaveLength(1);

      await closeSheet();
      // No banner covers the map; the selection and camera are retained.
      expect(
        screen.queryByRole("button", { name: / · Location details$/ }),
      ).toBeNull();
      expect(area).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(/125%/)).toBeVisible();

      fireEvent.click(area);
      sheet = screen.getByRole("dialog", { name: "Location details" });
      expect(sheet).toBeVisible();
      expect(area).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(/125%/)).toBeVisible();
    } finally {
      spy.mockRestore();
    }
  });

  it("reopens a closed location sheet by tapping the same location", async () => {
    const spy = phone();
    try {
      showPhone();
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      const cell = screen.getByRole("button", {
        name: "Select location FG-B · Stored & reserved",
      });
      fireEvent.click(cell);
      await closeSheet();
      expect(
        screen.queryByRole("button", { name: / · Location details$/ }),
      ).toBeNull();
      fireEvent.click(cell);
      expect(
        screen.getByRole("dialog", { name: "Location details" }),
      ).toBeVisible();
      expect(cell).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(/125%/)).toBeVisible();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("fallback location identity", () => {
  // Imported locations often use their code as the name.
  const sameNameDemo = (thai: boolean) => {
    const demo = floorMapDemo(false, thai);
    return {
      ...demo,
      zones: demo.zones.map((zone, index) =>
        index === 0 ? { ...zone, label: zone.code } : zone,
      ),
    };
  };
  const copy = {
    en: {
      select: "Select location DEMO-Z01",
      distinct: "Select location FG-B · Stored & reserved",
      region: "Selected location",
      dialog: "Location details",
      floor: "Floor 1",
    },
    th: {
      select: "เลือกจุดจัดเก็บ DEMO-Z01",
      distinct: "เลือกจุดจัดเก็บ FG-B · จัดเก็บและจอง",
      region: "จุดจัดเก็บที่เลือก",
      dialog: "รายละเอียดจุดจัดเก็บ",
      floor: "ชั้น 1",
    },
  } as const;
  // Visible elements whose own text names the location identity or floor;
  // stored units' position codes are separate records and are excluded.
  const visible = (scope: HTMLElement, text: string) =>
    within(scope).queryAllByText((_, node) =>
      Boolean(
        node &&
        node.tagName !== "title" &&
        !node.closest(".sr-only") &&
        !node.closest("li") &&
        [...node.childNodes].some(
          (child) =>
            child.nodeType === Node.TEXT_NODE &&
            child.textContent?.includes(text),
        ),
      ),
    );

  it.each(["en", "th"] as const)(
    "shows an equal name and code once in the %s desktop inspector",
    (locale) => {
      const text = copy[locale];
      renderWithIntl(<FloorMap {...sameNameDemo(locale === "th")} />, {
        locale,
        workspace: false,
      });
      fireEvent.click(screen.getByRole("button", { name: text.select }));
      const aside = screen.getByRole("complementary", { name: text.region });
      expect(
        within(aside).getByRole("heading", { name: "DEMO-Z01" }),
      ).toBeVisible();
      expect(visible(aside, "DEMO-Z01")).toHaveLength(1);
      expect(within(aside).getByText(text.floor)).toBeVisible();
      // A distinct name still shows its code.
      fireEvent.click(screen.getByRole("button", { name: text.distinct }));
      expect(
        within(
          screen.getByRole("complementary", { name: text.region }),
        ).getByText(`DEMO-Z02 · ${text.floor}`),
      ).toBeVisible();
    },
  );

  it.each(["en", "th"] as const)(
    "shows an equal name and code once in the %s phone sheet",
    (locale) => {
      const text = copy[locale];
      const original = window.matchMedia;
      const spy = vi
        .spyOn(window, "matchMedia")
        .mockImplementation((query) => ({
          ...original(query),
          matches: /max-width: (\d+)px/.test(query)
            ? Number(/max-width: (\d+)px/.exec(query)![1]) >= 580
            : false,
        }));
      try {
        renderWithIntl(<FloorMap {...sameNameDemo(locale === "th")} />, {
          locale,
          workspace: false,
        });
        fireEvent.click(screen.getByRole("button", { name: text.select }));
        const sheet = screen.getByRole("dialog", { name: text.dialog });
        expect(sheet).toHaveAccessibleDescription(`DEMO-Z01 · ${text.floor}`);
        expect(visible(sheet, "DEMO-Z01")).toHaveLength(1);
        expect(visible(sheet, text.floor)).toHaveLength(1);
        expect(
          within(sheet).getAllByRole("button", {
            name: locale === "th" ? "ปิดหน้าต่าง" : "Close dialog",
          }),
        ).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    },
  );
});
