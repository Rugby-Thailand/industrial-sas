import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { messagesFor } from "@/i18n/messages";
import { AreaOverview } from "./AreaOverview";

describe("AreaOverview", () => {
  it.each([
    [0, 0, "0%", "0 m² usable · 0 m² blocked"],
    [100, 100, "100%", "100 m² usable · 0 m² blocked"],
    [100, 99, "99%", "99 m² usable · 1 m² blocked"],
    [100, 1, "1%", "1 m² usable · 99 m² blocked"],
    [100, 0, "0%", "0 m² usable · 100 m² blocked"],
    [200, 150, "75%", "150 m² usable · 50 m² blocked"],
    [100, 99.99, "99.9%", "99.99 m² usable · 0.01 m² blocked"],
    [100, 0.01, "0.1%", "0.01 m² usable · 99.99 m² blocked"],
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
    expect(screen.getByText("พื้นที่ใช้งานได้")).toBeVisible();
    expect(
      screen.getByText("ใช้งานได้ 99 ตร.ม. · ทางเดิน / ห้ามจัดเก็บ 1 ตร.ม."),
    ).toBeVisible();
  });
});
