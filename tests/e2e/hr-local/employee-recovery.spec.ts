import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, convexAs } from "./fixtures";
import { readHrFixture } from "./setup";

const PROFILE = "hr/employeeProfile:employeeProfile";
const SAVE_PROFILE = "hr/employeeProfile:saveEmployeeProfile";
const LIFE = "hr/employeeProfile:employeeLifecycle";
const EVENT = "hr/employeeProfile:recordEmploymentEvent";

async function subject(page: Page) {
  await page.goto("/en/hr/employees");
  await expect(
    page.getByRole("button", { name: "Add employee", exact: true }),
  ).toBeVisible();
  const api = await convexAs(page);
  const code = `RECOVERY-${randomUUID().slice(0, 8)}`;
  const assignments: Record<string, string> = {};
  for (const [endpoint, field] of [
    ["hr/org:listDepartments", "departmentId"],
    ["hr/org:listPositions", "positionId"],
  ] as const) {
    const rows = (await api.query(endpoint)).value.items;
    const active = rows.find(
      (row: { status: string }) => row.status === "ACTIVE",
    );
    if (active) assignments[field] = active.id;
  }
  const created = await api.mutation("hr/setup:saveEmployee", {
    requestId: randomUUID(),
    warehouseId: readHrFixture().warehouseId,
    code,
    displayName: code,
    employmentStartDate: "2026-01-01",
    status: "ACTIVE",
    ...assignments,
  });
  expect(created.ok && created.value.written).toBe(true);
  await page.goto(`/en/hr/employees?q=${code}&status=ALL#recovery`);
  await page.getByRole("button", { name: `Edit ${code}`, exact: true }).click();
  await expect(page.getByTestId("hr-employee-profile")).toBeVisible();
  return { api, id: created.value.documentId as string };
}

/** Delay genuine server frames after a real mutation; never synthesize an answer. */
async function holdResponse(page: Page, endpoint: string) {
  let holding = false;
  let armed = true;
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
    abandon: () => {
      holding = false;
      queued.splice(0);
    },
    release: () => {
      holding = false;
      for (const send of queued.splice(0)) send();
    },
  };
}

async function retainedId(page: Page, privateValue: string) {
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
    "version",
  ]);
  expect(JSON.stringify(stored)).not.toContain(privateValue);
  return record.requestId as string;
}

for (const section of ["personal", "contact"] as const) {
  test(`employee ${section} committed response loss retains reachable ID-only recovery after version advances`, async ({
    page,
  }) => {
    const gate = await holdResponse(page, SAVE_PROFILE);
    const { api, id } = await subject(page);
    const label =
      section === "personal" ? "Edit personal details" : "Edit contact details";
    const title =
      section === "personal"
        ? "Personal details"
        : "Contact and emergency contact";
    const privateValue =
      section === "personal"
        ? "Synthetic retained nickname"
        : "synthetic@example.invalid";
    try {
      await page.getByRole("button", { name: label, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await dialog
        .getByLabel(section === "personal" ? "Nickname" : "Email", {
          exact: true,
        })
        .fill(privateValue);
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(gate.held).toBe(true);
      await expect
        .poll(
          async () =>
            (await api.query(PROFILE, { employeeId: id })).value.version,
        )
        .toBe(1);
      await retainedId(page, privateValue);
      gate.abandon();
      await page.reload();
      await expect(
        page.getByTestId(
          section === "personal"
            ? "hr-employee-personal"
            : "hr-employee-contact",
        ),
      ).toContainText(privateValue);
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(
        dialog.getByRole("button", {
          name: "Check previous write",
          exact: true,
        }),
      ).toBeVisible();
      await dialog
        .getByRole("button", { name: "Check previous write", exact: true })
        .click();
      await expect(
        dialog.getByText("The previous write was saved", { exact: true }),
      ).toBeVisible();
      expect((await api.query(PROFILE, { employeeId: id })).value.version).toBe(
        1,
      );
      expect(
        await page.evaluate(() =>
          Object.keys(sessionStorage).filter((key) =>
            key.startsWith("hr-request:"),
          ),
        ),
      ).toEqual([]);
    } finally {
      gate.release();
    }
  });
}

test("employee committed offboard response loss exposes recovery after its original action disappears", async ({
  page,
}) => {
  const gate = await holdResponse(page, EVENT);
  const { api, id } = await subject(page);
  const reason = "Synthetic recovery exit";
  try {
    await page
      .getByRole("button", {
        name: "Record resignation or termination",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Record resignation or termination",
      exact: true,
    });
    await dialog
      .getByLabel("Last working day", { exact: true })
      .fill("2026-09-30");
    await dialog.getByLabel(/^Reason/).fill(reason);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(gate.held).toBe(true);
    await expect
      .poll(async () => (await api.query(LIFE, { employeeId: id })).value.state)
      .toBe("RESIGNED");
    const requestId = await retainedId(page, reason);
    gate.abandon();
    await page.reload();
    await expect(page.getByTestId("hr-employee-lifecycle")).toContainText(
      reason,
    );
    await expect(
      page.getByRole("button", { name: "Reinstate", exact: true }),
    ).toBeVisible();
    // Recovery must remain available even though OFFBOARD became REINSTATE.
    await page.getByRole("button", { name: "Reinstate", exact: true }).click();
    const recovery = page.getByRole("button", {
      name: "Check previous write",
      exact: true,
    });
    await expect(recovery).toBeVisible();
    await recovery.click();
    await expect(
      page.getByText("The previous write was saved", { exact: true }),
    ).toBeVisible();
    const lifecycle = (await api.query(LIFE, { employeeId: id })).value;
    expect(lifecycle.events).toHaveLength(1);
    expect(lifecycle.version).toBe(2);
    expect(
      await page.evaluate(
        (id) =>
          Object.entries(sessionStorage).some(
            ([key, value]) =>
              key.startsWith("hr-request:") && value.includes(id),
          ),
        requestId,
      ),
    ).toBe(false);
  } finally {
    gate.release();
  }
});
