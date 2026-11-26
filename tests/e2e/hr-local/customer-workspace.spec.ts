import { randomUUID } from "node:crypto";

import { convexAs, expect, test } from "./fixtures";
import { readHrFixture } from "./setup";

test("warehouse scope, ticket filtering and product navigation survive Back and reload", async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(240_000);
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 960 });
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const name = `Siam Packaging ${suffix}`;
  const ticket = `JO-${suffix}`;
  const sku = `BOX-${suffix}`;
  const warehouseId = readHrFixture().warehouseId;
  const api = await convexAs(page);
  const created = await api.mutation("customers/writes:createCustomer", {
    requestId: randomUUID(),
    name,
    legalNameEn: name,
    deliveryAddress: {
      label: "Receiving dock 3",
      line: "99 Bang Phli Road",
      province: "Samut Prakan",
    },
    contact: { name: "Receiving team", role: "Dispatch" },
    notes: "Call the receiving team on arrival.",
  });
  expect(created.value.ok).toBe(true);
  const customerId = created.value.customerId;
  const scan = await api.mutation("finishedGoods/jobScans:saveJobScans", {
    requestId: randomUUID(),
    warehouseId,
    locationText: "Receiving dock",
    items: [
      {
        source: "MANUAL",
        customer: name,
        factoryOrder: ticket,
        productBarcodeText: sku,
      },
    ],
  });
  expect(scan.value.written).toBe(true);
  const product = await api.mutation("finishedGoods/workflow:saveProduct", {
    requestId: randomUUID(),
    warehouseId,
    sku,
    name: "Shipping carton",
    unit: "BOX",
    draft: false,
    storageFormat: "PALLET",
    storageCondition: "AMBIENT",
    customerLink: { action: "SET", customerId },
  });
  expect(product.value.written).toBe(true);

  const origin = `/en/master-data/customers/${customerId}?origin=queue#customer`;
  await page.goto(origin);
  const title = page.getByRole("heading", { level: 1, name, exact: true });
  const sections = page.getByRole("navigation", {
    name: "Customer workspace sections",
  });
  const jobLink = page
    .getByTestId("customer-recent-jobs")
    .getByRole("link", { name: new RegExp(ticket) });
  const productLink = page
    .getByTestId("customer-linked-products")
    .getByRole("link", { name: new RegExp(sku) });
  await expect(title).toBeVisible();
  await expect(jobLink).toBeVisible();
  await expect(productLink).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Needs attention" }),
  ).toBeVisible();
  const rail = page.getByRole("searchbox", { name: "Find a customer" });
  if (isMobile) {
    await expect(rail).toBeHidden();
    await expect(
      page.getByRole("link", { name: "All customers", exact: true }),
    ).toBeVisible();
  } else {
    await page
      .getByRole("button", { name: "All customers", exact: true })
      .click();
    await expect(rail).toBeFocused();
    await rail.fill(suffix);
    await expect(
      page
        .getByRole("complementary", { name: "Customers" })
        .getByRole("link", { name: new RegExp(name) }),
    ).toBeVisible();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("customer-overview.png"),
    fullPage: true,
  });
  await sections.getByRole("button", { name: "Job tickets" }).click();
  await page.getByRole("combobox", { name: "Warehouse", exact: true }).click();
  await page.getByRole("option", { name: /LOCAL-DEMO/ }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("warehouse") === warehouseId,
  );
  await page.getByRole("combobox", { name: "Location status" }).click();
  await page
    .getByRole("option", { name: "Awaiting location", exact: true })
    .click();
  await expect(jobLink).toBeVisible();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("filter") === "unmapped",
  );
  const filtered = new URL(page.url());
  expect(filtered.searchParams.get("filter")).toBe("unmapped");
  expect(filtered.searchParams.get("warehouse")).toBe(warehouseId);
  expect(filtered.searchParams.get("origin")).toBe("queue");
  expect(filtered.hash).toBe("#customer");
  await page.reload();
  await expect(jobLink).toBeVisible();
  await sections.getByRole("button", { name: "Products" }).click();
  await expect(productLink).toBeVisible();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("section") === "products",
  );
  const productsUrl = page.url();
  await productLink.click();
  await expect(page).toHaveURL(/\/finished-goods\/products\//);
  await page.goBack();
  await expect(page).toHaveURL(productsUrl);
  await expect(productLink).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(filtered.href);
  await expect(jobLink).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(productsUrl);
  await page
    .getByRole("button", { name: "View pallets and storage zones" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Stored pallets" }),
  ).toBeVisible();
  await expect(
    sections.getByRole("button", { name: "Products" }),
  ).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page).toHaveURL(productsUrl);
  await page.goBack();
  await expect(page).toHaveURL(filtered.href);
  await page.goBack();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("section") === "jobs" &&
      url.searchParams.get("warehouse") === warehouseId &&
      !url.searchParams.has("filter"),
  );
  await page.goBack();
  await expect(page).toHaveURL(
    (url) => url.pathname + url.search + url.hash === origin,
  );
  await page.getByRole("link", { name: "Scan job ticket" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname.endsWith("/finished-goods/scan") &&
      url.searchParams.get("customer") === customerId,
  );
  await expect(
    page.getByText(new RegExp("Scanning.*" + name, "i")),
  ).toBeVisible();
});
