import { randomUUID } from "node:crypto";
import type { Page, Locator } from "@playwright/test";
import { test, expect, convexAs } from "./fixtures";
import { readHrFixture } from "./setup";

const PROFILE = "hr/employeeProfile:employeeProfile";
const SAVE_PROFILE = "hr/employeeProfile:saveEmployeeProfile";
const PAYMENT = "hr/employeeProfile:employeePayment";
const SAVE_PAYMENT = "hr/employeeProfile:saveEmployeePayment";
const LIFE = "hr/employeeProfile:employeeLifecycle";

async function employee(page: Page, extra: Record<string, unknown> = {}) {
  await page.goto("/en/hr/employees");
  await expect(
    page.getByRole("button", { name: "Add employee", exact: true }),
  ).toBeVisible();
  const api = await convexAs(page);
  const code = `ACCEPT-${randomUUID().slice(0, 8)}`;
  const args: Record<string, unknown> = {
    warehouseId: readHrFixture().warehouseId,
    code,
    displayName: code,
    employmentStartDate: "2026-01-01",
    status: "ACTIVE",
  };
  for (const [endpoint, key] of [
    ["hr/org:listDepartments", "departmentId"],
    ["hr/org:listPositions", "positionId"],
  ]) {
    const rows = await api.query(endpoint!);
    const active = rows.value.items.find(
      (r: { status: string }) => r.status === "ACTIVE",
    );
    if (active) args[key!] = active.id;
  }
  Object.assign(args, extra);
  const saved = await api.mutation("hr/setup:saveEmployee", {
    ...args,
    requestId: randomUUID(),
  });
  expect(saved.value.written).toBe(true);
  const id = saved.value.documentId as string;
  await page.goto(`/en/hr/employees?q=${code}#acceptance`);
  await page.getByRole("button", { name: `Edit ${code}`, exact: true }).click();
  await expect(page.getByTestId("hr-employee-profile")).toBeVisible();
  return { api, id, code, args };
}
async function open(page: Page, kind: "personal" | "contact" | "payment") {
  const labels = {
    personal: "Edit personal details",
    contact: "Edit contact details",
    payment: "Edit payment details",
  };
  await page.getByRole("button", { name: labels[kind], exact: true }).click();
  const title = {
    personal: "Personal details",
    contact: "Contact and emergency contact",
    payment: "Payment details",
  };
  const dialog = page.getByRole("dialog", { name: title[kind], exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function save(dialog: Locator) {
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}
async function discard(page: Page, dialog: Locator) {
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const guard = page.getByRole("dialog", {
    name: "Save changes before leaving?",
  });
  if (await guard.isVisible())
    await guard
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
  await expect(dialog).toBeHidden();
}

test("employee personal contact emergency and private payment create edit and reload persist", async ({
  page,
}) => {
  const { api, id } = await employee(page);
  for (const suffix of ["created", "edited"]) {
    let d = await open(page, "personal");
    await d
      .getByLabel("First name", { exact: true })
      .fill(`Acceptance ${suffix}`);
    await d.getByLabel("Nickname", { exact: true }).fill(`Nick ${suffix}`);
    await save(d);
    d = await open(page, "contact");
    await d
      .getByLabel("Email", { exact: true })
      .fill(`${suffix}@example.invalid`);
    await d
      .getByLabel("Address", { exact: true })
      .fill(`Disposable ${suffix} address`);
    const emergency = d.getByRole("group", {
      name: "Emergency contact",
      exact: true,
    });
    await emergency
      .getByLabel("Name", { exact: true })
      .fill(`Contact ${suffix}`);
    await emergency.getByLabel("Relationship", { exact: true }).fill("Sibling");
    await emergency.getByLabel("Phone", { exact: true }).fill("0812345678");
    await save(d);
    d = await open(page, "payment");
    await d.getByLabel("Bank", { exact: true }).fill(`Test bank ${suffix}`);
    const account = suffix === "created" ? "1234567890" : "2345678901";
    await d.getByLabel("Account number", { exact: true }).fill(account);
    await d.getByLabel("Account name", { exact: true }).fill(`Payee ${suffix}`);
    await save(d);
    await page.reload();
    const personal = page.getByTestId("hr-employee-personal");
    await expect(personal).toContainText(`Acceptance ${suffix}`);
    await expect(page.getByTestId("hr-employee-contact")).toContainText(
      `Contact ${suffix}`,
    );
    const payment = page.getByTestId("hr-employee-payment");
    await expect(payment).toContainText(account.slice(-4));
    await expect(payment).not.toContainText(account);
    expect(
      (await api.query(PROFILE, { employeeId: id })).value.profile,
    ).toMatchObject({
      firstName: `Acceptance ${suffix}`,
      email: `${suffix}@example.invalid`,
      emergencyName: `Contact ${suffix}`,
      emergencyPhone: "0812345678",
    });
    expect(
      (await api.query(PAYMENT, { employeeId: id })).value.payment,
    ).toMatchObject({ accountNumber: account, accountName: `Payee ${suffix}` });
    d = await open(page, "payment");
    await expect(d.getByLabel("Account number", { exact: true })).toHaveValue(
      account,
    );
    await d.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(d).toBeHidden();
  }
});

test("employee foreground opened while the editor URL commit is delayed keeps the editor and its URL", async ({
  page,
}) => {
  // A slow editor RSC response (dev compile, slow network) once let the
  // optimistic editor accept a foreground before its URL existed; the
  // foreground's history entry then superseded the router push and closed it.
  await page.route(
    (url) =>
      url.pathname.endsWith("/hr/employees") &&
      url.searchParams.get("mode") === "edit",
    async (route) => {
      if (route.request().headers()["rsc"] === "1")
        await new Promise((resolve) => setTimeout(resolve, 4_000));
      await route.continue();
    },
  );
  const { code } = await employee(page);
  const d = await open(page, "personal");
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("mode") === "edit" &&
      url.searchParams.has("employee") &&
      url.searchParams.get("q") === code &&
      url.hash === "#acceptance",
  );
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(d).toBeHidden();
  await expect(page.getByTestId("hr-employee-profile")).toBeVisible();
});

test("employee dirty personal draft survives independent subscription refresh and stale save refuses without overwrite", async ({
  page,
}) => {
  const { api, id } = await employee(page);
  const d = await open(page, "personal");
  await d
    .getByLabel("First name", { exact: true })
    .fill("Retained private draft");
  const before = (await api.query(PROFILE, { employeeId: id })).value;
  expect(
    (
      await api.mutation(SAVE_PROFILE, {
        employeeId: id,
        expectedVersion: before.version,
        requestId: randomUUID(),
        firstName: "Independent committed value",
      })
    ).value.written,
  ).toBe(true);
  await expect(
    d.getByText(/These details changed while this editor was open/),
  ).toBeVisible();
  await expect(d.getByLabel("First name", { exact: true })).toHaveValue(
    "Retained private draft",
  );
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(d.getByText(/Nothing was saved/)).toBeVisible();
  await expect(d.getByLabel("First name", { exact: true })).toHaveValue(
    "Retained private draft",
  );
  expect(
    (await api.query(PROFILE, { employeeId: id })).value.profile.firstName,
  ).toBe("Independent committed value");
  await page.goBack();
  const guard = page.getByRole("dialog", {
    name: "Save changes before leaving?",
  });
  await guard
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await expect(d.getByLabel("First name", { exact: true })).toHaveValue(
    "Retained private draft",
  );
  await discard(page, d);
  await page.reload();
  await expect(page.getByTestId("hr-employee-personal")).toContainText(
    "Independent committed value",
  );
});

/** A transparent relay: holds actual server frames; no fake handler/result. */
async function responseGate(page: Page, endpoint: string) {
  let armed = true;
  let holding = false;
  const queued: (() => void)[] = [];
  await page.routeWebSocket("ws://127.0.0.1:3320/**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((data) => {
      if (armed && String(data).includes(endpoint)) {
        holding = true;
        armed = false;
      }
      server.send(data);
    });
    server.onMessage((data) => {
      if (holding) queued.push(() => socket.send(data));
      else socket.send(data);
    });
  });
  return {
    held: () => holding,
    release: () => {
      holding = false;
      for (const send of queued.splice(0)) send();
    },
    abandon: () => {
      holding = false;
      queued.splice(0);
    },
  };
}

test("employee real response-gated pending save retains Back protection through query refresh and consumes completion entry", async ({
  page,
}) => {
  const gate = await responseGate(page, SAVE_PROFILE);
  const { api, id, args, code } = await employee(page);
  const d = await open(page, "personal");
  await d
    .getByLabel("Nickname", { exact: true })
    .fill("Pending retained nickname");
  try {
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(gate.held).toBe(true);
    await expect
      .poll(
        async () =>
          (await api.query(PROFILE, { employeeId: id })).value.profile.nickname,
      )
      .toBe("Pending retained nickname");
    const version = (await api.query(LIFE, { employeeId: id })).value.version;
    expect(
      (
        await api.mutation("hr/setup:saveEmployee", {
          ...args,
          employeeId: id,
          expectedVersion: version,
          requestId: randomUUID(),
          displayName: `${code} refreshed`,
        })
      ).value.written,
    ).toBe(true);
    await expect(
      d.getByRole("button", { name: "Submitting…", exact: true }),
    ).toBeDisabled();
    await page.goBack();
    await expect(d).toBeVisible();
    await expect(
      d.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    await d.getByRole("button", { name: "Close", exact: true }).click();
    await expect(d).toBeVisible();
    await expect(
      d.getByRole("button", { name: "Submitting…", exact: true }),
    ).toBeDisabled();
    await expect(d.getByLabel("Nickname", { exact: true })).toHaveValue(
      "Pending retained nickname",
    );
  } finally {
    gate.release();
  }
  await expect(d).toBeHidden();
  await expect(page.getByTestId("hr-employee-personal")).toContainText(
    "Pending retained nickname",
  );
  await page.goBack();
  await expect(page.getByTestId("hr-employee-profile")).toBeHidden();
  await expect(page).toHaveURL(
    new RegExp(`/en/hr/employees\\?q=${code}#acceptance$`),
  );
  await page.reload();
  expect(
    (await (await convexAs(page)).query(PROFILE, { employeeId: id })).value
      .profile.nickname,
  ).toBe("Pending retained nickname");
});

test("employee committed ID-only real reload recovers without sensitive payload storage", async ({
  page,
}) => {
  const gate = await responseGate(page, SAVE_PAYMENT);
  const { api, id } = await employee(page);
  const d = await open(page, "payment");
  await d.getByLabel("Bank", { exact: true }).fill("Private acceptance bank");
  await d.getByLabel("Account number", { exact: true }).fill("3456789012");
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(gate.held).toBe(true);
  await expect
    .poll(
      async () =>
        (await api.query(PAYMENT, { employeeId: id })).value.payment
          ?.accountNumber,
    )
    .toBe("3456789012");
  const stored = await page.evaluate(() =>
    Object.entries(sessionStorage).filter(([key]) =>
      key.startsWith("hr-request:"),
    ),
  );
  expect(stored).toHaveLength(1);
  const record = JSON.parse(stored[0]![1]);
  expect(Object.keys(record).sort()).toEqual([
    "operation",
    "requestId",
    "revision",
    "version",
  ]);
  expect(record.revision).toBe(0);
  expect(JSON.stringify(stored)).not.toContain("3456789012");
  gate.abandon();
  await page.reload();
  await expect(page.getByTestId("hr-employee-payment")).toContainText("9012");
  const reopened = await open(page, "payment");
  await expect(
    reopened.getByRole("button", { name: "Check previous write", exact: true }),
  ).toBeVisible();
  await reopened
    .getByRole("button", { name: "Check previous write", exact: true })
    .click();
  await expect(
    reopened.getByText("The previous write was saved", { exact: true }),
  ).toBeVisible();
  expect((await api.query(PAYMENT, { employeeId: id })).value.version).toBe(1);
});

test("employee unsent ID-only real reload fences request without replaying private draft", async ({
  page,
  context,
}) => {
  const { api, id } = await employee(page);
  const d = await open(page, "personal");
  await d
    .getByLabel("Nickname", { exact: true })
    .fill("Private unsent nickname");
  let stored: [string, string][] = [];
  await context.setOffline(true);
  try {
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await expect(d.getByRole("button", { name: /Submitting/ })).toBeDisabled();
    stored = await page.evaluate(() =>
      Object.entries(sessionStorage).filter(([key]) =>
        key.startsWith("hr-request:"),
      ),
    );
    expect(stored).toHaveLength(1);
    expect(Object.keys(JSON.parse(stored[0]![1])).sort()).toEqual([
      "operation",
      "requestId",
      "revision",
      "version",
    ]);
    expect(JSON.parse(stored[0]![1]).revision).toBe(0);
    // Destroy the old document/Convex socket while it is offline. This is an
    // actual navigation, rather than clearing a live client queue by hand.
    await page.goto("about:blank");
  } finally {
    await context.setOffline(false);
  }
  await page.goBack();
  await page.reload();
  const reopened = await open(page, "personal");
  await reopened
    .getByRole("button", { name: "Check previous write", exact: true })
    .click();
  await expect(
    reopened.getByText("The previous write did not apply", { exact: true }),
  ).toBeVisible();
  expect(
    (await api.query(PROFILE, { employeeId: id })).value.profile.nickname,
  ).toBeUndefined();
  const requestId = JSON.parse(stored[0]![1]).requestId;
  const late = await api.mutation(SAVE_PROFILE, {
    employeeId: id,
    expectedVersion: 0,
    requestId,
    nickname: "Private unsent nickname",
  });
  expect(late.value.written).toBe(false);
  expect(
    (await api.query(PROFILE, { employeeId: id })).value.profile.nickname,
  ).toBeUndefined();
});
