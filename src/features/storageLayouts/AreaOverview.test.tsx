import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { messagesFor } from "@/i18n/messages";
import { AreaOverview } from "./AreaOverview";

describe("AreaOverview", () => {
  it.each([
    [0, 0, "0%", "Free 0 m²"],
    [100, 100, "100%", "Free 100 m²"],
    [100, 99, "99%", "Free 99 m²"],
    [100, 1, "1%", "Free 1 m²"],
    [100, 0, "0%", "Free 0 m²"],
    [200, 150, "75%", "Free 150 m²"],
    [100, 99.99, "99.9%", "Free 99.99 m²"],
    [100, 0.01, "0.1%", "Free 0.01 m²"],
  ])(
    "describes gross %s and usable %s without relying on colour",
    (gross, usable, percent, summary) => {
      render(
        <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
          <AreaOverview
            grossAreaSqMm={gross * 1_000_000}
            usableAreaSqMm={usable * 1_000_000}
          />
        </NextIntlClientProvider>,
      );
      expect(screen.getByText(summary)).toBeVisible();
      expect(screen.getByText(`: ${percent}`)).toBeInTheDocument();
    },
  );
  it("provides Thai floor-footprint labels", () => {
    render(
      <NextIntlClientProvider locale="th" messages={messagesFor("th")}>
        <AreaOverview grossAreaSqMm={100_000_000} usableAreaSqMm={99_000_000} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("พื้นที่ว่างคงเหลือ")).toBeVisible();
    expect(screen.getByText("ว่าง 99 ตร.ม.")).toBeVisible();
  });
});

it("shows zero remaining on a full building and omits the detailed subtitle", () => {
  render(
    <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
      <AreaOverview
        grossAreaSqMm={80_000_000}
        usableAreaSqMm={64_000_000}
        storedFootprintAreaSqMm={60_000_000}
        heldFootprintAreaSqMm={4_000_000}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText("Free 0 m²")).toBeVisible();
  expect(screen.getByText(": 0%")).toBeInTheDocument();
  expect(screen.getByRole("img")).toHaveAccessibleName(
    "Free 0 m² · Stored 60 m² · Reserved 4 m² · Unavailable 16 m²",
  );
});
