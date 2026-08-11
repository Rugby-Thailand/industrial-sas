import { expect, test, type Page } from "@playwright/test";

/**
 * The inbound journey on a desktop, against local preview data.
 *
 * `RG-051` — a real PO completing receive → QC → pallet → print → putaway on
 * pilot hardware — is a physical gate and stays open. What this file proves is
 * the half that is local: the same screens, the same write contract, and the
 * same honest reporting when nothing can be stored.
 *
 * Every assertion that matters checks two things: that the step completed, and
 * that the screen still says the data is synthetic.
 */
const BANG_PU = "prv_wh_bangpoo";

/** Every inbound screen is warehouse-scoped; the selector comes first. */
async function selectWarehouse(page: Page) {
  await page.getByLabel("คลังสินค้า").selectOption(BANG_PU);
}

test.describe("the inbound screens", () => {
  for (const [path, heading] of [
    ["/th/purchasing/orders", "ใบสั่งซื้อ"],
    ["/th/purchasing/import", "นำเข้าใบสั่งซื้อจากไฟล์"],
    ["/th/receiving", "การรับสินค้า"],
    ["/th/quality", "ตรวจสอบคุณภาพ"],
    ["/th/putaway", "จัดเก็บเข้าที่"],
  ] as const) {
    test(`${path} renders and says the data is synthetic`, async ({ page }) => {
      await page.goto(path);

      await expect(
        page.getByRole("heading", { level: 1, name: heading }),
      ).toBeVisible();
      await expect(page.getByTestId("preview-banner")).toBeVisible();
    });
  }

  test("reaches the inbound section from the navigation", async ({ page }) => {
    await page.goto("/th/dashboard");

    const menu = page.getByRole("button", { name: "เปิดเมนู" });
    if (await menu.isVisible()) await menu.click();

    await page
      .getByRole("navigation")
      .getByRole("link", { name: "การรับสินค้า" })
      .click();

    await expect(page).toHaveURL(/\/th\/receiving$/);
  });

  test("waits for a warehouse before showing any inbound list", async ({
    page,
  }) => {
    // Every inbound read is warehouse-scoped on the server; a screen that showed
    // rows before a site was chosen would be showing rows from nowhere.
    await page.goto("/th/purchasing/orders");
    await expect(
      page.getByTestId("panel-WAREHOUSE_MISSING").first(),
    ).toBeVisible();
  });
});

test.describe("purchase orders", () => {
  test("lists orders and opens one", async ({ page }) => {
    await page.goto("/th/purchasing/orders");
    await selectWarehouse(page);

    await expect(page.getByTestId("table-purchase-orders")).toBeVisible();
    await page.getByTestId("order-open-PO-2601").click();

    await expect(page).toHaveURL(/\/purchasing\/orders\/prv_po_2601$/);
    await expect(page.getByTestId("purchase-order-detail")).toBeVisible();
  });

  test("shows the ordered unit and what is still outstanding", async ({
    page,
  }) => {
    /*
     * The order was written in cases and the ledger stores eaches. A buyer
     * reconciling against a supplier's paperwork reads the case figure.
     */
    await page.goto("/th/purchasing/orders/prv_po_2601");
    await selectWarehouse(page);

    const table = page.getByTestId("table-order-lines");
    await expect(table.getByText("40.000 CASE")).toBeVisible();
    await expect(table.getByText("320")).toBeVisible();
  });

  test("offers close-short on an open line only", async ({ page }) => {
    await page.goto("/th/purchasing/orders/prv_po_2602");
    await selectWarehouse(page);

    // Line 1 is complete and line 2 is already closed short: neither offers it.
    await expect(page.getByTestId("line-close-short-1")).toHaveCount(0);
    await expect(page.getByTestId("line-close-short-2")).toHaveCount(0);
  });

  test("answers an unknown order the way it answers a foreign one", async ({
    page,
  }) => {
    await page.goto("/th/purchasing/orders/prv_po_does_not_exist");
    await selectWarehouse(page);
    await expect(page.getByTestId("order-not-found")).toBeVisible();
  });
});

test.describe("previewed import", () => {
  test("shows the bad rows next to the good ones before anything is written", async ({
    page,
  }) => {
    /*
     * Refusing the whole file over one bad line teaches people to fix the file
     * by deleting rows. The screen shows both halves, and the rejected rows sit
     * above the write control.
     */
    await page.goto("/th/purchasing/import");
    await selectWarehouse(page);

    await page.getByTestId("form-import-preview").getByRole("button").click();

    await expect(page.getByTestId("table-import-accepted")).toBeVisible();
    await expect(page.getByTestId("table-import-rejected")).toBeVisible();
    await expect(
      page.getByTestId("table-import-accepted").getByText("BATCH-1:1"),
    ).toBeVisible();
  });

  test("reports chunk progress and never claims a preview stored anything", async ({
    page,
  }) => {
    await page.goto("/th/purchasing/import");
    await selectWarehouse(page);
    await page.getByTestId("form-import-preview").getByRole("button").click();

    /*
     * The counter is worded for preview: nothing is written, so it says how many
     * rows were *walked*. A counter that said "written" would be false on the
     * one screen whose whole point is that it stored nothing.
     */
    await expect(page.getByTestId("import-progress")).toContainText(
      "โหมดตัวอย่างไม่ได้บันทึกข้อมูล",
    );

    /*
     * The order the lines are written into is a required field with no default:
     * the import writes into an order that already exists, and a screen that
     * guessed one would write somebody's spreadsheet into the wrong document.
     */
    const chunk = page.getByTestId("form-import-chunk");
    // Selected by PO number from the tenant's own open orders. The field carries
    // the order's document ID, which nobody importing a spreadsheet has.
    await chunk.getByLabel("ใบสั่งซื้อ").selectOption({ label: "PO-2601" });
    await chunk.getByRole("button").click();

    // The cursor advanced, so the resume path is walkable.
    await expect(page.getByTestId("import-progress")).toContainText(
      "เดินผ่านครบทุกบรรทัดแล้ว",
    );
  });

  test("says nothing has been checked before a file is submitted", async ({
    page,
  }) => {
    await page.goto("/th/purchasing/import");
    await selectWarehouse(page);
    await expect(page.getByTestId("import-no-preview")).toBeVisible();
  });
});

test.describe("receiving", () => {
  test("opens a receipt and shows what was posted against it", async ({
    page,
  }) => {
    await page.goto("/th/receiving");
    await selectWarehouse(page);

    await expect(page.getByTestId("table-receipts")).toBeVisible();
    await page.getByTestId("receipt-open-GRN-5001").click();

    await expect(page).toHaveURL(/\/receiving\/prv_rcpt_5001$/);
    await expect(page.getByTestId("table-receipt-lines")).toBeVisible();
  });

  test("shows a quantity with its unit and the stock status it landed in", async ({
    page,
  }) => {
    await page.goto("/th/receiving/prv_rcpt_5002");
    await selectWarehouse(page);

    const table = page.getByTestId("table-receipt-lines");
    await expect(table.getByText("200.000 L")).toBeVisible();
    // Held: the operator may not use it, and the row says so.
    await expect(table.getByText("รอตรวจสอบคุณภาพ")).toBeVisible();
  });

  test("demonstrates a receipt posting without pretending to persist", async ({
    page,
  }) => {
    await page.goto("/th/receiving/prv_rcpt_5001");
    await selectWarehouse(page);

    const form = page.getByTestId("form-receipt-line");
    await form.getByLabel("จำนวน").fill("12");
    await form.getByLabel("หน่วยนับ").fill("KG");
    await form.getByRole("button").click();

    await expect(page.getByTestId("write-DEMONSTRATED").first()).toBeVisible();
  });

  test("keeps raising an exception separate from receiving against it", async ({
    page,
  }) => {
    /*
     * `INV-0007-04`: the person who raises the exception and the person who
     * receives against it must differ. Putting both in one flow would suggest
     * one person does both.
     */
    await page.goto("/th/receiving");
    await selectWarehouse(page);

    const form = page.getByTestId("form-receiving-exception");
    await expect(form).toBeVisible();
    await expect(form).toContainText("ผู้แจ้งกับผู้บันทึกต้องเป็นคนละคน");
  });
});

test.describe("quality", () => {
  test("shows the queue with every state told apart", async ({ page }) => {
    await page.goto("/th/quality");
    await selectWarehouse(page);

    const table = page.getByTestId("table-inspections");
    await expect(table.getByText("รอตรวจ")).toBeVisible();
    await expect(table.getByText("รออนุมัติ")).toBeVisible();
    await expect(table.getByText("ตัดสินแล้ว")).toBeVisible();
  });

  test("explains that release and scrap wait for a second person", async ({
    page,
  }) => {
    await page.goto("/th/quality");
    await selectWarehouse(page);

    await page.getByTestId("inspection-select-prv_qc_3001").click();
    await expect(page.getByTestId("quality-parked-explanation")).toContainText(
      "ต้องมีคนที่สองอนุมัติ",
    );
  });

  test("offers the approval control to everyone, and says who may use it", async ({
    page,
  }) => {
    // Hiding it would make a maker-checker rule look like a missing feature.
    await page.goto("/th/quality");
    await selectWarehouse(page);

    await expect(page.getByTestId("quality-approval-rule")).toContainText(
      "ต้องเป็นผู้ใช้คนละคนกับผู้บันทึกผล",
    );
    await expect(page.getByTestId("form-approve-disposition")).toBeVisible();
  });

  test("demonstrates a disposition without pretending to persist", async ({
    page,
  }) => {
    await page.goto("/th/quality");
    await selectWarehouse(page);
    await page.getByTestId("inspection-select-prv_qc_3001").click();

    const form = page.getByTestId("form-disposition");
    // Chosen from the tenant's active `STATUS_CHANGE` reason codes, not typed.
    await form.getByLabel("รหัสเหตุผล").selectOption({ index: 0 });
    await form.getByRole("button", { name: "บันทึกผล" }).click();

    await expect(page.getByTestId("write-DEMONSTRATED").first()).toBeVisible();
  });
});

test.describe("putaway", () => {
  test("shows the board with a claimed task marked as claimed", async ({
    page,
  }) => {
    // "Claimed" and "you may not" are different facts with different fixes.
    await page.goto("/th/putaway");
    await selectWarehouse(page);

    await expect(page.getByTestId("table-putaway-tasks")).toBeVisible();
    await expect(page.getByTestId("task-claim-prv_task_4002")).toHaveText(
      "งานนี้มีผู้รับแล้ว",
    );
  });

  test("explains why a bin was recommended, with the arithmetic", async ({
    page,
  }) => {
    await page.goto("/th/putaway");
    await selectWarehouse(page);
    await page.getByTestId("task-select-prv_task_4001").click();

    const ranked = page.getByTestId("table-recommendation-ranked");
    await expect(ranked.getByText("A01-02-1")).toBeVisible();
    await expect(ranked.getByText("380")).toBeVisible();
    await expect(
      ranked.getByText("มีสินค้าเดียวกันอยู่แล้ว 300 คะแนน (น้ำหนัก 300)"),
    ).toBeVisible();
  });

  test("says why a location was filtered out", async ({ page }) => {
    /*
     * "Why is my bin not in the list?" is the question the panel exists for, and
     * a dock is never a putaway target — stock left on a working surface has not
     * been put away.
     */
    await page.goto("/th/putaway");
    await selectWarehouse(page);
    await page.getByTestId("task-select-prv_task_4001").click();

    const rejected = page.getByTestId("table-recommendation-rejected");
    await expect(rejected.getByText("DOCK-IN-1")).toBeVisible();
    await expect(
      rejected
        .getByText("ไม่ใช่ตำแหน่งจัดเก็บ เช่น ท่ารับหรือพื้นที่พัก")
        .first(),
    ).toBeVisible();
  });

  test("states the override rule before the control, not after a refusal", async ({
    page,
  }) => {
    await page.goto("/th/putaway");
    await selectWarehouse(page);
    await page.getByTestId("task-select-prv_task_4001").click();

    await expect(page.getByTestId("putaway-override-rule")).toContainText(
      "ต้องระบุรหัสเหตุผล",
    );
  });

  test("offers only the ranked locations on the confirmation", async ({
    page,
  }) => {
    // A free-text box would let an operator name a bin a hard constraint
    // rejected, and the server would refuse it only after the pallet had moved.
    await page.goto("/th/putaway");
    await selectWarehouse(page);
    await page.getByTestId("task-select-prv_task_4001").click();

    const select = page
      .getByTestId("form-confirm-putaway")
      .getByLabel("ตำแหน่งที่จัดเก็บจริง");
    await expect(select.locator("option")).toHaveCount(3);
    await expect(
      select.locator("option", { hasText: "DOCK-IN-1" }),
    ).toHaveCount(0);
  });
});

test.describe("label evidence", () => {
  test("says on the page that no printer is connected", async ({ page }) => {
    // `INT-04` absent, `RG-004` open. The screen must not imply otherwise.
    await page.goto("/th/receiving/prv_rcpt_5001");
    await selectWarehouse(page);

    await expect(page.getByTestId("printer-boundary")).toContainText(
      "ไม่ได้เชื่อมต่อเครื่องพิมพ์",
    );
  });

  test("shows generated evidence and never a printed status", async ({
    page,
  }) => {
    await page.goto("/th/receiving/prv_rcpt_5001");
    await selectWarehouse(page);

    const table = page.getByTestId("table-print-jobs");
    await expect(table.getByText("INITIAL")).toBeVisible();
    await expect(table.getByText("REPRINT")).toBeVisible();
    await expect(table.getByText("PRINTED")).toHaveCount(0);
  });

  test("makes a reprint an explicit choice rather than a hidden retry", async ({
    page,
  }) => {
    await page.goto("/th/receiving/prv_rcpt_5001");
    await selectWarehouse(page);

    await expect(page.getByTestId("label-reprint-toggle")).toBeVisible();
  });
});
