import { randomUUID } from "node:crypto";

import { test, expect, convexAs } from "./fixtures";

/*
 * Customers v1 against the real local app, Convex functions and Clerk session
 * (plan acceptance 1 and 7). The seeded organization administrator holds the
 * customer grants because new organizations are seeded with them.
 */

test.describe("customers on a 390px phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a Thai name-only customer saves in under 10 seconds and survives reload", async ({
    page,
  }, info) => {
    test.setTimeout(420_000);
    const name = `บริษัท ทดสอบ ${randomUUID().slice(0, 6)} จำกัด`;
    // The local server is `next dev`, which compiles a route on its first
    // request. Open one customer's page first, so the timed save measures
    // the save rather than a one-off compile a production build never does.
    const api = await convexAs(page);
    const warm = await api.mutation("customers/writes:createCustomer", {
      requestId: randomUUID(),
      name: `Warm-up ${randomUUID().slice(0, 6)}`,
    });
    expect(warm.ok && warm.value.ok).toBe(true);
    // Untimed warm-up: a first compile on a busy machine can take minutes.
    await page.goto(`/th/master-data/customers/${warm.value.customerId}`, {
      waitUntil: "domcontentloaded",
      timeout: 240_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 240_000,
    });
    await page.goto("/th/master-data/customers/new");
    const field = page.getByRole("textbox", { name: /ชื่อลูกค้า/ });
    await expect(field).toBeEditable();
    const started = Date.now();
    await field.fill(name);
    await page
      .getByRole("button", { name: "บันทึกลูกค้า", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name, exact: true }),
    ).toBeVisible();
    const elapsedMs = Date.now() - started;
    info.annotations.push({
      type: "customer-name-only-save-ms",
      description: String(elapsedMs),
    });
    expect(elapsedMs).toBeLessThan(10_000);
    const customerId = page.url().split("/").pop()!.split(/[?#]/)[0]!;
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name, exact: true }),
    ).toBeVisible();
    // A fresh token: the warm-up on a busy machine can outlast the first.
    const verifier = await convexAs(page);
    const stored = await verifier.query("customers/catalogue:getCustomer", {
      customerId,
    });
    expect(stored.ok).toBe(true);
    expect(stored.value).toMatchObject({ name, status: "ACTIVE" });
    expect(stored.value).not.toHaveProperty("legalNameTh");
  });

  test("Back after a refused edit keeps the draft behind a discard prompt", async ({
    page,
  }) => {
    const api = await convexAs(page);
    const created = await api.mutation("customers/writes:createCustomer", {
      requestId: randomUUID(),
      name: `Conflict ${randomUUID().slice(0, 6)}`,
    });
    expect(created.ok && created.value.ok).toBe(true);
    const customerId = created.value.customerId as string;
    await page.goto(`/en/master-data/customers/${customerId}`);
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    const nameField = page.getByRole("textbox", { name: /Customer name/ });
    await expect(nameField).toBeEditable();
    // Someone else saves first, so this editor's version is stale.
    const elsewhere = await api.mutation("customers/writes:updateCustomer", {
      requestId: randomUUID(),
      customerId,
      expectedVersion: 1,
      name: "Renamed elsewhere",
    });
    expect(elsewhere.ok && elsewhere.value.ok).toBe(true);
    await nameField.fill("Renamed on the phone");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByTestId("customer-version-conflict")).toBeVisible();
    await page.goBack();
    await expect(
      page.getByRole("dialog", { name: "Discard changes?" }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(
      `/en/master-data/customers/${customerId}/edit`,
    );
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(nameField).toHaveValue("Renamed on the phone");
    await expect(page.getByTestId("customer-version-conflict")).toBeVisible();
  });
});
