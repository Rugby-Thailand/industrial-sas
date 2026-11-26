import { expect, test } from "@playwright/test";

test("catalogue announces a rejected activation and blocks a duplicate click during the write", async ({
  page,
}) => {
  const activation = "**/fixture-save?write=activate-building";
  const requests: unknown[] = [];
  let release!: () => void;
  const failed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(activation, async (route) => {
    requests.push(route.request().postDataJSON());
    await failed;
    await route.abort("failed");
  });

  try {
    await page.goto("/en/storage-catalogue");
    const status = page.getByRole("switch", {
      name: "Building status: FIXTURE",
    });
    await expect(status).toBeEnabled();
    await expect(status).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Checking status…")).toHaveCount(0);
    await status.click();

    const confirmation = page.getByRole("dialog", {
      name: "Activate FIXTURE?",
    });
    await confirmation
      .getByRole("button", { name: "Activate building" })
      .click();
    const pending = confirmation.getByRole("button", {
      name: "Saving status…",
    });
    await expect(pending).toBeDisabled();
    await expect.poll(() => requests.length).toBe(1);
    const bounds = await pending.boundingBox();
    expect(bounds).not.toBeNull();
    if (bounds) {
      await page.mouse.click(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
    }
    release();

    await expect(confirmation).toHaveCount(0);
    await expect(
      page.getByRole("alert").filter({ hasText: "Check your connection" }),
    ).toHaveCount(1);
    await expect(status).toBeEnabled();
    await expect(status).toHaveAttribute("aria-checked", "false");
    await page
      .getByRole("button", { name: "Status change failed: FIXTURE" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Status change failed: FIXTURE" }),
    ).toContainText("Check your connection");
    expect(requests).toHaveLength(1);
  } finally {
    release();
  }
});
