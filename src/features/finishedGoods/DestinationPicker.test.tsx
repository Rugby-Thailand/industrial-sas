import { messagesFor } from "@/i18n/messages";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate } from "@/lib/convex/finishedGoodsApi";
import { finishedGoodDestination } from "@tests/fixtures/finished-goods-ui";
import {
  DestinationPicker,
  destinationKey,
  filterDestinations,
} from "./DestinationPicker";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

const destination: Candidate = {
  ...finishedGoodDestination,
  zoneId: "zone-b",
  locationName: "Dispatch",
  locationCode: "SHIP-Z02",
  buildingName: "Outbound Warehouse",
  buildingCode: "OUT-B",
  floorNumber: 7,
  supportPositionId: "rack-b",
  supportLabel: "Loading rack",
  supportCode: "RACK-07",
};
const candidates = [finishedGoodDestination, destination];

beforeEach(() => sessionStorage.clear());

describe("shared destination search", () => {
  it.each([
    "dispatch",
    "SHIP-Z02",
    "outbound",
    "out-b",
    "Floor 7",
    "ชั้น 7",
    "Loading rack",
    "rack-07",
    "  DiSpAtCh  ",
  ])(
    "finds the same destination by %s without changing server order",
    (search) => {
      expect(filterDestinations(candidates, search)).toEqual([destination]);
      expect(filterDestinations(candidates, " ")).toEqual(candidates);
    },
  );

  it("keeps floor, shelf and pallet surfaces separate within one location", () => {
    const surfaces = [
      finishedGoodDestination,
      { ...finishedGoodDestination, supportPositionId: "same-id" },
      { ...finishedGoodDestination, supportPalletId: "same-id" },
    ];
    expect(new Set(surfaces.map(destinationKey)).size).toBe(3);
  });

  it.each(["storage", "move"] as const)(
    "searching %s never selects or changes the recommendation",
    (context) => {
      const onSelect = vi.fn();
      render(
        <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
          <DestinationPicker
            context={context}
            candidates={candidates}
            selected={destinationKey(finishedGoodDestination)}
            onSelect={onSelect}
            recommended={finishedGoodDestination}
          />
        </NextIntlClientProvider>,
      );
      const search = screen.getByRole("textbox");
      fireEvent.change(search, { target: { value: "SHIP-Z02" } });
      const option = screen.getByRole("button", { name: /Dispatch/ });
      expect(option).toHaveAttribute("aria-pressed", "false");
      expect(option).not.toHaveTextContent("Recommended");
      expect(onSelect).not.toHaveBeenCalled();
      fireEvent.click(option);
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(
        destinationKey(destination),
      );
      fireEvent.change(search, { target: { value: "unmatched" } });
      expect(screen.getByRole("status")).toHaveTextContent("No matching");
      expect(screen.getByText("0 / 2")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
      expect(search).toHaveValue("");
      const options = within(screen.getByRole("region"));
      expect(options.getAllByRole("button")).toHaveLength(2);
      expect(options.getByRole("button", { name: /FG-1/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(options.getByText("Recommended")).toBeVisible();
    },
  );

  it("shows Thai controls and keeps an empty list recoverable", () => {
    render(
      <NextIntlClientProvider locale="th" messages={messagesFor("th")}>
        <DestinationPicker candidates={[]} selected="" onSelect={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("textbox", { name: "ค้นหาจุดจัดเก็บ" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "ไม่พบจุดจัดเก็บที่ตรงกัน",
    );
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("restores search after a correction round trip only within the caller's scope", () => {
    const open = (stateKey: string) =>
      render(
        <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
          <DestinationPicker
            candidates={candidates}
            selected={destinationKey(finishedGoodDestination)}
            onSelect={vi.fn()}
            stateKey={stateKey}
          />
        </NextIntlClientProvider>,
      );
    const first = open("actor-a:warehouse-a:unit-a:search");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "SHIP-Z02" },
    });
    first.unmount();
    const returned = open("actor-a:warehouse-a:unit-a:search");
    expect(screen.getByRole("textbox")).toHaveValue("SHIP-Z02");
    expect(
      within(screen.getByRole("region")).getAllByRole("button"),
    ).toHaveLength(1);
    returned.unmount();
    open("actor-b:warehouse-a:unit-a:search");
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(
      within(screen.getByRole("region")).getAllByRole("button"),
    ).toHaveLength(2);
  });
});

describe("paged destination choices", () => {
  const many: Candidate[] = Array.from({ length: 60 }, (_, n) => ({
    ...finishedGoodDestination,
    zoneId: `zone-${n}`,
    locationName: `Bay ${String(n).padStart(2, "0")}`,
    locationCode: `BAY-${n}`,
  }));
  function mount(selected: string, onSelect = vi.fn()) {
    return render(
      <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
        <DestinationPicker
          candidates={many}
          selected={selected}
          recommended={many[0]}
          onSelect={onSelect}
          stateKey="paged-destinations"
        />
      </NextIntlClientProvider>,
    );
  }
  const options = () =>
    within(screen.getByRole("region", { name: "Location options" }))
      .getAllByRole("button")
      .map((button) => button.textContent ?? "");

  it("pages the complete ranked list and keeps the chosen and recommended ones reachable", () => {
    mount(destinationKey(many[3]!));
    expect(options()).toHaveLength(25);
    expect(options()[0]).toContain("Bay 00");
    expect(screen.getByText("1–25 of 60")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("26–50 of 60")).toBeInTheDocument();
    const page = options();
    // Selected and recommended are pinned, marked, and then the page in order.
    expect(page[0]).toContain("Bay 00");
    expect(page[1]).toContain("Bay 03");
    expect(page[0]).toContain("From another page");
    expect(page[2]).toContain("Bay 25");
    expect(page).toHaveLength(27);
    expect(
      screen.getByRole("button", { name: /Bay 03/, pressed: true }),
    ).toBeInTheDocument();
  });

  it("returns to the first page of the filtered list when searching", () => {
    mount("");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "bay 5" },
    });
    expect(options().map((text) => text.slice(0, 6))).toEqual([
      "Bay 50",
      "Bay 51",
      "Bay 52",
      "Bay 53",
      "Bay 54",
      "Bay 55",
      "Bay 56",
      "Bay 57",
      "Bay 58",
      "Bay 59",
    ]);
    // A short result needs no pager.
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
