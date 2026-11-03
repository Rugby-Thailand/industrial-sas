import { test, expect } from "./fixtures";

for (const locale of ["en", "th"] as const) {
  test(`workplace context keeps storage selection separate from HR (${locale})`, async ({
    page,
  }, info) => {
    const mobile = (page.viewportSize()?.width ?? 1280) < 1024;
    const openMenu = locale === "en" ? "Open menu" : "เปิดเมนู";
    const closeMenu = locale === "en" ? "Close menu" : "ปิดเมนู";
    await page.goto(`/${locale}/finished-goods`);
    if (mobile)
      await page.getByRole("button", { name: openMenu, exact: true }).click();
    const warehouse = page.getByTestId("warehouse-select");
    await expect(warehouse).toBeVisible();
    const selected = await warehouse.textContent();
    expect(selected?.trim()).toBeTruthy();
    if (mobile)
      await page.getByRole("button", { name: closeMenu, exact: true }).click();

    await page.goto(`/${locale}/hr/roster`);
    await expect(
      page.getByRole("combobox", {
        name: locale === "en" ? "Workplace" : "สถานที่ทำงาน",
        exact: true,
      }),
    ).toBeVisible();
    if (mobile)
      await page.getByRole("button", { name: openMenu, exact: true }).click();
    await expect(page.getByTestId("sidebar-warehouse")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-warehouse-rail")).toHaveCount(0);
    if (mobile)
      await page.getByRole("button", { name: closeMenu, exact: true }).click();
    const shot = info.outputPath(`workplace-${locale}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    await info.attach("workplace context", {
      path: shot,
      contentType: "image/png",
    });

    await page.goto(`/${locale}/finished-goods`);
    if (mobile)
      await page.getByRole("button", { name: openMenu, exact: true }).click();
    await expect(warehouse).toHaveText(selected!);
  });
}
