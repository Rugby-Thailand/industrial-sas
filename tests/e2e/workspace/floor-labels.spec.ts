import { expect, test } from "@playwright/test";

for (const locale of ["en", "th"]) {
  test(`keeps FG1 location codes at 14 px without status text across zoom (${locale})`, async ({
    page,
  }) => {
    await page.goto(`/?fixture=fg1&locale=${locale}`);
    const map = page.locator('svg[role="group"]');
    await expect(map.locator("[data-floor-zone-code]")).toHaveCount(15);
    const zoomIn = page.getByRole("button", {
      name: locale === "th" ? "ขยายภาพ" : "Zoom in",
      exact: true,
    });
    for (const zoom of [1, 2, 3]) {
      if (zoom > 1) for (let step = 0; step < 4; step++) await zoomIn.click();
      await expect
        .poll(async () =>
          map.evaluate((svg) => {
            const labels = [
              ...svg.querySelectorAll<SVGTextElement>("[data-floor-zone-name]"),
            ];
            return (
              labels.length > 0 &&
              labels.every((label) => {
                const matrix = label.getScreenCTM()!;
                return (
                  Math.abs(
                    Number(label.getAttribute("font-size")) *
                      Math.hypot(matrix.a, matrix.b) -
                      14,
                  ) < 0.01
                );
              })
            );
          }),
        )
        .toBe(true);
      const errors = await map.evaluate((svg) => {
        const errors: string[] = [];
        const viewport = svg.getBoundingClientRect();
        const scale = svg.lastElementChild!.getBoundingClientRect();
        const footer = svg
          .parentElement!.querySelector("[data-floor-map-footer]")!
          .getBoundingClientRect();
        for (const label of svg.querySelectorAll<SVGTextElement>(
          "[data-floor-zone-name]",
        )) {
          const text = label.getBoundingClientRect();
          const face = label.previousElementSibling!.getBoundingClientRect();
          if (
            text.left < viewport.left ||
            text.right > viewport.right ||
            text.top < viewport.top ||
            text.bottom > Math.min(viewport.bottom, footer.top) ||
            (text.left < scale.right &&
              text.right > scale.left &&
              text.top < scale.bottom &&
              text.bottom > scale.top) ||
            text.left < face.left + 3 ||
            text.right > face.right - 3 ||
            text.top < face.top + 3 ||
            text.bottom > face.bottom - 3
          )
            errors.push(label.textContent ?? "");
        }
        return errors;
      });
      expect(errors).toEqual([]);
      await expect(
        map.locator("[data-floor-zone-status], [data-floor-callout]"),
      ).toHaveCount(0);
    }
    await expect(
      map.locator('[data-floor-zone-code="FG1-R03"]'),
    ).toHaveAttribute("data-floor-zone-state", "stored");
    await expect(
      map.locator('[data-floor-zone-code="FG1-R08"]'),
    ).toHaveAttribute("data-floor-zone-state", "reserved");
    await expect(
      map.locator('[data-floor-zone-code="FG1-R08"]'),
    ).toHaveAttribute("stroke-dasharray", "4 3");
  });
}
