import { randomUUID } from "node:crypto";

import { test, expect, convexAs } from "./fixtures";
import { readHrFixture } from "./setup";

const BLUE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQi5r2HwADtgIOas69kQAAAABJRU5ErkJggg==";
const RED =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4pGH0HwAFKAIsWRQhMAAAAABJRU5ErkJggg==";
const GREEN =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQW2DzHwAD1AH6mPShBQAAAABJRU5ErkJggg==";
type LogoReadWindow = Window & { releaseHrLogoRead?: () => void };

test("protocol legacy employee save retains all six org fields through registered API and reload", async ({
  page,
}) => {
  await page.goto("/en/hr/employees");
  const api = await convexAs(page);
  const tag = randomUUID().slice(0, 8);
  const create = async (name: string, args: Record<string, unknown>) => {
    const result = await api.mutation(name, {
      requestId: randomUUID(),
      ...args,
    });
    expect(result.ok && result.value.written).toBe(true);
    return result.value.documentId as string;
  };
  const departmentId = await create("hr/org:saveDepartment", {
    name: `Protocol department ${tag}`,
    status: "ACTIVE",
  });
  const positionId = await create("hr/org:savePosition", {
    name: `Protocol position ${tag}`,
    status: "ACTIVE",
  });
  const levelId = await create("hr/org:saveLevel", {
    name: `Protocol level ${tag}`,
    status: "ACTIVE",
    sortOrder: 20,
  });
  const branches = (await api.query("hr/org:listBranches")).value.items;
  const used = new Set(
    branches.map((row: { revenueBranchNo: string }) => row.revenueBranchNo),
  );
  let number = 30001;
  while (used.has(String(number))) number += 1;
  const branchId = await create("hr/org:saveBranch", {
    name: `Protocol branch ${tag}`,
    revenueBranchNo: String(number),
    ssoEmployerAccount: "1234567890",
    type: "BRANCH",
    status: "ACTIVE",
    address: "123 Local test road",
    province: "Bangkok",
    district: "Pathum Wan",
    subDistrict: "Lumphini",
    postcode: "10330",
  });
  const code = `OLD-${tag}`;
  const legacyFields = {
    warehouseId: readHrFixture().warehouseId,
    code,
    displayName: `Legacy ${tag}`,
    employmentStartDate: "2026-01-01",
    status: "INACTIVE",
  };
  const orgFields = {
    departmentId,
    positionId,
    levelId,
    branchId,
    employmentType: "FIXED_TERM",
    probationEndDate: "2027-01-31",
  };
  const employeeId = await create("hr/setup:saveEmployee", {
    ...legacyFields,
    ...orgFields,
    replaceOrgFields: true,
  });
  const before = (await api.query("hr/setup:employee", { employeeId })).value
    .employee;
  const oldWrite = await api.mutation("hr/setup:saveEmployee", {
    requestId: randomUUID(),
    employeeId,
    expectedVersion: before.version,
    ...legacyFields,
    displayName: `Legacy preserved ${tag}`,
    // Deliberately the real old-client shape: marker and six new fields absent.
  });
  expect(oldWrite.ok && oldWrite.value.written).toBe(true);
  const after = (await api.query("hr/setup:employee", { employeeId })).value
    .employee;
  expect(after).toMatchObject(orgFields);
  expect(after.version).toBe(before.version + 1);
  await page.goto(
    `/en/hr/employees?employee=${employeeId}&mode=edit&q=${code}`,
  );
  const form = page.getByTestId("hr-employee-form");
  await expect(form.getByLabel(/^Display name/)).toHaveValue(
    `Legacy preserved ${tag}`,
  );
  await page.reload();
  await expect(
    form.getByRole("combobox", { name: "Department", exact: true }),
  ).toHaveText(`Protocol department ${tag}`);
  await expect(
    form.getByRole("combobox", { name: "Position", exact: true }),
  ).toHaveText(`Protocol position ${tag}`);
  await expect(
    form.getByRole("combobox", { name: "Level", exact: true }),
  ).toHaveText(`Protocol level ${tag}`);
  await expect(
    form.getByRole("combobox", { name: "Branch", exact: true }),
  ).toHaveText(`Protocol branch ${tag}`);
  await expect(
    form.getByRole("radio", { name: "Fixed-term", exact: true }),
  ).toBeChecked();
  await expect(form.getByLabel(/^Probation end date/)).toHaveValue(
    "2027-01-31",
  );
});

test("protocol two real logo editors fence stale file remove and ABA then persist explicit reapply", async ({
  page,
  context,
}, info) => {
  await page.goto("/en/hr/today?origin=logo-protocol#origin");
  const api = await convexAs(page);
  const previous = (await api.query("hr/org:getCompanyLogo")).value;
  const initialArgs = {
    requestId: randomUUID(),
    expectedRevision: previous?.revision ?? null,
    mimeType: "image/png",
    base64: BLUE,
  };
  const initial = await api.mutation("hr/org:saveCompanyLogo", initialArgs);
  expect(initial.ok && initial.value.written).toBe(true);
  await page.goto("/en/hr/settings?section=company#logo");
  const form = page.getByTestId("hr-company-form");
  const input = form.getByLabel("Company logo", { exact: true });
  const preview = form.getByRole("img", {
    name: "Current company logo",
    exact: true,
  });
  await expect(preview).toHaveAttribute("src", `data:image/png;base64,${BLUE}`);
  const observedA = (await api.query("hr/org:getCompanyLogo")).value.revision;
  const second = await context.newPage();
  try {
    await second.goto("/en/hr/settings?section=company");
    const secondForm = second.getByTestId("hr-company-form");
    await expect(
      secondForm.getByRole("img", {
        name: "Current company logo",
        exact: true,
      }),
    ).toHaveAttribute("src", `data:image/png;base64,${BLUE}`);
    // Delay only real File IO in editor A. Auth, transport and backend stay real.
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      const pending = new Promise<void>((resolve) => {
        (window as LogoReadWindow).releaseHrLogoRead = resolve;
      });
      File.prototype.arrayBuffer = async function () {
        const bytes = await original.call(this);
        await pending;
        return bytes;
      };
    });
    await input.setInputFiles({
      name: "selected-red.png",
      mimeType: "image/png",
      buffer: Buffer.from(RED, "base64"),
    });
    await expect(input).toBeDisabled();
    await page.goBack();
    const guard = page.getByRole("dialog", {
      name: "Save changes before leaving?",
    });
    await expect(page.getByTestId("navigation-guard-pending")).toBeVisible();
    await expect(
      guard.getByRole("button", { name: "Discard changes", exact: true }),
    ).toBeDisabled();
    await guard
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await secondForm.getByLabel("Company logo", { exact: true }).setInputFiles({
      name: "newer-green.png",
      mimeType: "image/png",
      buffer: Buffer.from(GREEN, "base64"),
    });
    await expect(
      secondForm.getByRole("img", {
        name: "Current company logo",
        exact: true,
      }),
    ).toHaveAttribute("src", `data:image/png;base64,${GREEN}`);
    await page.evaluate(() => (window as LogoReadWindow).releaseHrLogoRead?.());
    const apply = form.getByRole("button", {
      name: "Apply selected file to current logo",
      exact: true,
    });
    await expect(apply).toBeVisible();
    await expect(form.getByText(/selected-red\.png/)).toBeVisible();
    expect((await api.query("hr/org:getCompanyLogo")).value.base64).toBe(GREEN);
    const replay = await api.mutation("hr/org:saveCompanyLogo", initialArgs);
    expect(replay.ok && replay.value.written).toBe(true);
    expect((await api.query("hr/org:getCompanyLogo")).value.base64).toBe(GREEN);
    const staleRemoval = await api.mutation("hr/org:saveCompanyLogo", {
      requestId: randomUUID(),
      remove: true,
      expectedRevision: observedA,
    });
    expect(staleRemoval.value).toMatchObject({
      written: false,
      error: { code: "LOGO_STALE" },
    });
    await apply.click();
    await expect(apply).toBeHidden();
    await expect(preview).toHaveAttribute(
      "src",
      `data:image/png;base64,${RED}`,
    );
    await page.reload();
    await expect(preview).toHaveAttribute(
      "src",
      `data:image/png;base64,${RED}`,
    );
    const current = (
      await (await convexAs(page)).query("hr/org:getCompanyLogo")
    ).value;
    const profileBefore = (await api.query("hr/org:getCompanyProfile")).value
      .profile;
    for (const partial of [{ mimeType: "image/png" }, { base64: RED }]) {
      const refused = await api.mutation("hr/org:saveCompanyLogo", {
        requestId: randomUUID(),
        expectedRevision: current.revision,
        remove: true,
        ...partial,
      });
      expect(refused.value).toMatchObject({
        written: false,
        error: { code: "LOGO_FILE_INVALID" },
      });
    }
    const legacy = await api.mutation("hr/org:saveCompanyLogo", {
      requestId: randomUUID(),
      remove: true,
    });
    expect(legacy.value).toMatchObject({
      written: false,
      error: { code: "LOGO_STALE" },
    });
    expect((await api.query("hr/org:getCompanyLogo")).value).toEqual(current);
    expect((await api.query("hr/org:getCompanyProfile")).value.profile).toEqual(
      profileBefore,
    );
    expect(
      (
        await api.mutation("hr/org:saveCompanyLogo", {
          requestId: randomUUID(),
          remove: true,
          expectedRevision: current.revision,
        })
      ).value.written,
    ).toBe(true);
    expect(
      (
        await api.mutation("hr/org:saveCompanyLogo", {
          requestId: randomUUID(),
          mimeType: "image/png",
          base64: GREEN,
          expectedRevision: null,
        })
      ).value.written,
    ).toBe(true);
    const recreated = (await api.query("hr/org:getCompanyLogo")).value;
    expect(recreated.revision.id).not.toBe(current.revision.id);
    const aba = await api.mutation("hr/org:saveCompanyLogo", {
      requestId: randomUUID(),
      remove: true,
      expectedRevision: current.revision,
    });
    expect(aba.value).toMatchObject({
      written: false,
      error: { code: "LOGO_STALE" },
    });
    await second.reload();
    await expect(
      secondForm.getByRole("img", {
        name: "Current company logo",
        exact: true,
      }),
    ).toHaveAttribute("src", `data:image/png;base64,${GREEN}`);
    const screenshot = info.outputPath("two-editor-logo-persisted.png");
    await second.screenshot({ path: screenshot, fullPage: true });
    await info.attach("two-editor logo persistence", {
      path: screenshot,
      contentType: "image/png",
    });
  } finally {
    await second.close();
  }
});
