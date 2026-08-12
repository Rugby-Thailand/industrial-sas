import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Operating the shared Radix Select from an end-to-end test.
 *
 * Playwright's `selectOption()` speaks to a native `<select>` and nothing else:
 * it sets the element's value directly and dispatches `change`. There is no
 * native select left in production, and there is nothing to regret about that —
 * a native popup is drawn by the operating system, which is why a dark-scheme
 * device rendered a white menu no page style could reach.
 *
 * What replaces it is deliberately *not* a value assignment. These helpers open
 * the menu, find the row, and press it, so what the suite exercises is the
 * control an operator actually uses: the trigger reacts, the portal opens, the
 * row is hit-tested, focus returns. `selectOption()` would have passed against a
 * select that was invisible, zero-height, or covered by the header.
 *
 * Selection stays by **value** wherever the old suite selected by value. The
 * warehouse ID is what the server is handed, so a test naming it keeps testing
 * the same thing when the Thai copy changes. Radix does not put the value in the
 * DOM, so `SelectControl` writes it as `data-value` for exactly this purpose.
 */
export interface SelectChoice {
  /** The submitted value, e.g. a warehouse ID. Preferred where one is known. */
  readonly value?: string;
  /** The visible text, for lists whose values are opaque server identifiers. */
  readonly label?: string;
  /** Position, for "any of them will do" cases such as a reason code. */
  readonly index?: number;
}

/** The open menu. Radix portals it, so it is never inside the form. */
const menuOf = (page: Page): Locator => page.getByRole("listbox");

/**
 * Open a select by the visible label its `<label for>` names, and return the
 * menu.
 *
 * The trigger is a `<button>`, which is a labelable element, so `getByLabel`
 * finds it the same way it found the native control.
 */
export async function openSelect(
  page: Page,
  label: string,
  scope: Page | Locator = page,
): Promise<Locator> {
  await scope.getByLabel(label).click();
  const menu = menuOf(page);
  await expect(menu).toBeVisible();
  return menu;
}

/** Open a select, choose a row, and wait for the menu to close behind it. */
export async function chooseOption(
  page: Page,
  label: string,
  choice: SelectChoice,
  scope: Page | Locator = page,
): Promise<void> {
  const menu = await openSelect(page, label, scope);

  const option =
    choice.value !== undefined
      ? menu.locator(`[role="option"][data-value="${choice.value}"]`)
      : choice.label !== undefined
        ? menu.getByRole("option", { name: choice.label, exact: true })
        : menu.getByRole("option").nth(choice.index ?? 0);

  await option.click();
  /*
   * Waited for rather than assumed. Radix closes on commit and returns focus to
   * the trigger; a test that carried on immediately would race the portal's exit
   * animation and click through the overlay that is still on its way out.
   */
  await expect(menu).toBeHidden();
}

/** What a select is currently showing. The label of the row, not its value. */
export const selectedText = (
  page: Page,
  label: string,
  scope: Page | Locator = page,
): Promise<string> => scope.getByLabel(label).innerText();

/** Open a select, read something out of it, and close it again. */
async function inspect<Value>(
  page: Page,
  label: string,
  scope: Page | Locator,
  read: (menu: Locator) => Promise<Value>,
): Promise<Value> {
  const menu = await openSelect(page, label, scope);
  const value = await read(menu);
  /*
   * Closed with Escape rather than left open. A portalled menu covers the page
   * with an overlay, and a test that inspected one and walked away would fail
   * its *next* click for a reason that has nothing to do with what it asserts.
   */
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  return value;
}

/** The submitted value of every row, in order. */
export const optionValues = (
  page: Page,
  label: string,
  scope: Page | Locator = page,
): Promise<string[]> =>
  inspect(page, label, scope, (menu) =>
    menu
      .locator('[role="option"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-value") ?? ""),
      ),
  );

/** The visible text of every row, in order. */
export const optionLabels = (
  page: Page,
  label: string,
  scope: Page | Locator = page,
): Promise<string[]> =>
  inspect(page, label, scope, (menu) =>
    menu.locator('[role="option"]').allInnerTexts(),
  );

/**
 * Assert which row is currently chosen, by the value the server would receive.
 *
 * Radix keeps the value in React state rather than on the trigger, so the check
 * is on the row itself: the chosen one is marked `data-state="checked"`, which
 * is the same attribute the check mark beside it is drawn from. Asserting the
 * value rather than the label keeps this test failing on behaviour instead of on
 * a copy edit.
 */
export const expectSelectedValue = async (
  page: Page,
  label: string,
  value: string,
  scope: Page | Locator = page,
): Promise<void> => {
  await inspect(page, label, scope, async (menu) => {
    await expect(
      menu.locator(`[role="option"][data-value="${value}"]`),
    ).toHaveAttribute("data-state", "checked");
  });
};
