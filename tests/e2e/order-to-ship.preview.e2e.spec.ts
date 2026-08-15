import { expect, test } from "@playwright/test";

import { seedPreviewWarehouse } from "./support/accessibility";

test.describe("order-to-ship preview workspace", () => {
  test.beforeEach(async ({ page }) => {
    await seedPreviewWarehouse(page);
  });

  test("prefills sales actions from the selected order instead of asking for an opaque ID", async ({
    page,
  }) => {
    await page.goto("/th/sales/orders");
    await expect(
      page.getByRole("heading", { level: 1, name: "คำสั่งซื้อลูกค้า" }),
    ).toBeVisible();
    const order = page.getByRole("listitem").filter({ hasText: "SO-26018" });
    await order.getByText("ดำเนินการคำสั่งซื้อนี้").click();
    await expect(order.getByLabel("รหัสคำสั่งซื้อลูกค้า").first()).toHaveValue(
      "prv_so_26018",
    );
  });

  test("shows similarity as a separate human decision and exposes revision history", async ({
    page,
  }) => {
    await page.goto("/th/engineering/designs");
    await expect(
      page.getByRole("heading", { level: 1, name: "ควบคุมแบบวิศวกรรม" }),
    ).toBeVisible();
    await expect(page.getByText("prv_dr_42")).toBeVisible();
    await page
      .getByRole("button", {
        name: "ค้นหาแบบที่อนุมัติและมีโครงสร้างตรงกัน",
      })
      .first()
      .click();
    await expect(
      page.getByText(/โหมดเซิร์ฟเวอร์จะแสดงแบบที่อนุมัติ/).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "ทะเบียนรีวิชันมาสเตอร์การ์ด" }),
    ).toBeVisible();
    await expect(page.getByText("prv_mc_gold_991")).toBeVisible();
  });

  test("renders a printable full factory packet and usable file controls", async ({
    page,
  }) => {
    await page.goto("/th/production/packets");
    await expect(
      page.getByRole("heading", { level: 1, name: "ใบงานโรงงาน" }),
    ).toBeVisible();
    await expect(page.getByText("SO-26018-1")).toBeVisible();
    for (const section of [
      "ชั้นกระดาษ",
      "วัตถุดิบ",
      "ข้อกำหนดคุณภาพ",
      "การคำนวณที่ตรวจสอบแล้ว",
      "การบรรจุ",
    ]) {
      await expect(page.getByRole("heading", { name: section })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "ดาวน์โหลด" })).toHaveCount(
      2,
    );
  });

  test("renders the complete workflow in English without changing route context", async ({
    page,
  }) => {
    for (const [route, heading] of [
      ["/en/sales/orders", "Customer orders"],
      ["/en/engineering/designs", "Engineering design control"],
      ["/en/production/packets", "Factory packets"],
    ] as const) {
      await page.goto(route);
      await expect(
        page.getByRole("heading", { level: 1, name: heading }),
      ).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "Order-to-ship workflow" }),
      ).toBeVisible();
    }
  });
});
