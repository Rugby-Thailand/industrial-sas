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
        <NextIntlClientProvider locale="en" messages={{}}>
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
      <NextIntlClientProvider locale="th" messages={{}}>
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
        <NextIntlClientProvider locale="en" messages={{}}>
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
