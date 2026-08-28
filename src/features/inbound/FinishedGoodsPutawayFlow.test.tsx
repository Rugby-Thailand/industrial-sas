import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

import { FinishedGoodsPutawayFlow } from "./FinishedGoodsPutawayFlow";

const renderFlow = () =>
  renderWithIntl(<FinishedGoodsPutawayFlow />, {
    locale: "th",
    workspace: false,
  });

describe("finished-goods putaway flow", () => {
  it("starts with the measured general-Area path", () => {
    renderFlow();

    expect(screen.getByText("แนะนำ Area ทั่วไป")).toBeInTheDocument();
    expect(
      screen.getByText(/ย้าย balance ทุก bucket พร้อมหลักฐาน audit/),
    ).toBeInTheDocument();
  });

  it("shows the exact-child prompt instead of an ambiguous parent posting", () => {
    renderFlow();

    fireEvent.click(
      screen.getByRole("button", { name: /วัดแล้ว · ตำแหน่งย่อย/ }),
    );

    expect(screen.getByText("ต้องเลือกตำแหน่งที่แน่นอน")).toBeInTheDocument();
    expect(
      screen.getByText(/แผนผัง\/รายการแทนการปล่อย stock/),
    ).toBeInTheDocument();
  });

  it("stops measured goods when every destination violates a hard rule", () => {
    renderFlow();

    fireEvent.click(
      screen.getByRole("button", { name: /วัดแล้ว · ไม่มีที่ปลอดภัย/ }),
    );

    expect(
      screen.getByText("ส่ง staging หรือเปิด exception"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ไม่ post ledger ไปปลายทางที่ถูก block/),
    ).toBeInTheDocument();
  });

  it("keeps unknown dimensions honest and routes to measurement", () => {
    renderFlow();

    fireEvent.click(
      screen.getByRole("button", { name: /ยังไม่วัด · ไม่มี profile/ }),
    );

    expect(screen.getByText("ความมั่นใจต่ำ")).toBeInTheDocument();
    expect(screen.getByText(/FG measurement staging/)).toBeInTheDocument();
  });
});
