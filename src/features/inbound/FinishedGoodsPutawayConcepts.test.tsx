import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

import { FinishedGoodsPutawayConcepts } from "./FinishedGoodsPutawayConcepts";

const renderConcepts = (locale: "th" | "en" = "th") =>
  renderWithIntl(<FinishedGoodsPutawayConcepts />, {
    locale,
    workspace: false,
  });

describe("finished-goods putaway concepts", () => {
  it("starts with the guided measured flow and permits Area-level storage", () => {
    renderConcepts();

    expect(screen.getByTestId("putaway-style-guided")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "นำไปที่ BULK-A" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ยืนยันแล้วว่าพอดี", { exact: true }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ที่อยู่ระดับ Area/)).toBeInTheDocument();
  });

  it("changes unmeasured goods to an honest low-confidence flow", () => {
    renderConcepts();

    const measurementSwitch = screen.getByRole("switch", {
      name: "สถานะการวัดสินค้าสำเร็จรูป",
    });
    expect(measurementSwitch).toBeChecked();
    fireEvent.click(measurementSwitch);
    expect(measurementSwitch).not.toBeChecked();

    expect(screen.getByText("ยังไม่มีขนาดสินค้า")).toBeInTheDocument();
    expect(
      screen.getByText("ยังยืนยันการพอดีไม่ได้", { exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ตรวจพื้นที่จริงแล้วสแกน Area" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "วัดขนาดตอนนี้" }));
    expect(screen.getByText("วัด LPN นี้แล้ว")).toBeInTheDocument();
  });

  it("compares candidates and captures a destination with the scanner fallback", () => {
    renderConcepts();

    fireEvent.click(screen.getByRole("tab", { name: /2 · เทียบก่อนเลือก/ }));
    const panel = screen.getByTestId("putaway-style-compare");
    expect(panel).toBeInTheDocument();

    const fgEast = within(panel).getByRole("radio", { name: /FG-EAST/ });
    fireEvent.click(fgEast);
    expect(fgEast).toBeChecked();

    fireEvent.click(
      within(panel).getByRole("button", { name: "สแกน Area ปลายทาง" }),
    );
    expect(
      screen.getByRole("dialog", { name: "สแกน QR หรือบาร์โค้ดปลายทาง" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("สแกนไม่ได้? กรอกรหัสจากป้าย"), {
      target: { value: "FG-EAST" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ใช้รหัสนี้" }));

    expect(screen.getByText("พร้อมสแกน FG-EAST")).toBeInTheDocument();
    expect(screen.getByText(/อ่านรหัส FG-EAST แล้ว/)).toBeInTheDocument();
  });

  it("supports keyboard navigation between the three style tabs", () => {
    renderConcepts("en");

    const guided = screen.getByRole("tab", { name: /1 · Guided mission/ });
    fireEvent.keyDown(guided, { key: "ArrowRight" });
    expect(screen.getByTestId("putaway-style-compare")).toBeInTheDocument();

    const compare = screen.getByRole("tab", { name: /2 · Decision cockpit/ });
    fireEvent.keyDown(compare, { key: "ArrowRight" });
    expect(screen.getByTestId("putaway-style-map")).toBeInTheDocument();
  });
});
