import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  chooseOption,
  openSelect,
  selectedLabel,
} from "@tests/fixtures/select-control";

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  args: new Map<string, unknown>(),
  save: vi.fn(),
  identityKey: "org-a:user-a",
}));

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) => {
      if (args === "skip") return undefined;
      state.args.set(name(reference), args);
      return state.queries.get(name(reference));
    },
    useMutation: () => state.save,
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    timezone: "Asia/Bangkok",
    identityKey: state.identityKey,
  }),
  useHrCan: () => true,
}));

import { hrRefs } from "@/lib/convex/hrApi";
import { EmployeeForm, type EmployeeRecord } from "./EmployeeForm";

const SITES = [{ id: "w1", code: "HQ", name: "Head office" }];
const items = (rows: readonly Record<string, unknown>[]) => ({
  ok: true,
  requestId: "q",
  value: { items: rows },
});
const emptyPage = {
  ok: true,
  requestId: "q",
  value: {
    ok: true,
    status: "ready",
    page: [],
    isDone: true,
    continueCursor: "",
  },
};
const E001: EmployeeRecord = {
  id: "e1",
  code: "2400001",
  displayName: "Somchai",
  status: "ACTIVE",
  siteId: "w1",
  employmentStartDate: "2024-01-08",
  departmentId: "d-old",
  departmentName: "Recruitment",
  positionId: "p3",
  positionName: "General staff",
  employmentType: "FIXED_TERM",
  probationEndDate: "2024-05-07",
  version: 4,
};

let actor = 0;
beforeEach(() => {
  state.identityKey = `org-a:user-${++actor}`;
  state.queries.clear();
  state.args.clear();
  state.save.mockReset();
  window.sessionStorage.clear();
  state.queries.set(getFunctionName(hrRefs.memberOptionsPage), emptyPage);
  state.queries.set(
    getFunctionName(hrRefs.departmentOptions),
    items([
      { id: "d1", name: "Sales", status: "ACTIVE" },
      { id: "d-old", name: "Recruitment", status: "INACTIVE" },
    ]),
  );
  state.queries.set(
    getFunctionName(hrRefs.positionOptions),
    items([
      { id: "p1", name: "Managing Director", status: "ACTIVE" },
      { id: "p2", name: "Department Manager", status: "ACTIVE" },
      { id: "p3", name: "General staff", status: "ACTIVE" },
    ]),
  );
  state.queries.set(
    getFunctionName(hrRefs.levelOptions),
    items([{ id: "l1", name: "CEO", status: "ACTIVE" }]),
  );
  state.queries.set(
    getFunctionName(hrRefs.branchOptions),
    items([{ id: "b1", name: "HQ", status: "ACTIVE" }]),
  );
});

function render(employee?: EmployeeRecord, onDone = vi.fn()) {
  renderWithIntl(
    <EmployeeForm
      {...(employee === undefined ? {} : { employee })}
      sites={SITES}
      today="2026-10-20"
      onDone={onDone}
    />,
    { locale: "en" },
  );
  return onDone;
}

describe("employee Employment group (S01-13..18)", () => {
  it("groups department, position, level, supervisor, branch, workplace, status, type and probation", () => {
    render(E001);
    const group = screen.getByRole("group", { name: "Employment" });
    for (const label of [
      "Department",
      "Position",
      "Level",
      "Supervisor",
      "Branch",
      "Workplace",
      "Employment status",
    ])
      expect(
        within(group).getByLabelText(new RegExp(`^${label}( \\*)?$`)),
      ).toBeInTheDocument();
    const type = within(group).getByRole("group", { name: "Employment type" });
    expect(
      within(type).getByRole("radio", { name: "Permanent" }),
    ).not.toBeChecked();
    expect(
      within(type).getByRole("radio", { name: "Fixed-term" }),
    ).toBeChecked();
    expect(within(group).getByLabelText("On probation")).toBeChecked();
    expect(within(group).getByLabelText(/^Probation end date/)).toHaveValue(
      "2024-05-07",
    );
  });

  it("keeps an inactive current department selected and asks for its current id", () => {
    render(E001);
    expect(state.args.get(getFunctionName(hrRefs.departmentOptions))).toEqual({
      currentId: "d-old",
    });
    expect(selectedLabel("Department *")).toBe("Recruitment (inactive)");
    const labels = within(openSelect("Position *"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(labels).toEqual([
      "Managing Director",
      "Department Manager",
      "General staff",
    ]);
  });

  it("requires a department and position while active ones exist, then sends the employment fields", async () => {
    state.save.mockResolvedValue({
      ok: true,
      value: { written: true, documentId: "e9", replayed: false },
    });
    state.queries.set(getFunctionName(hrRefs.suggestEmployeeCode), {
      ok: true,
      requestId: "q",
      value: { ok: true, code: "6900012" },
    });
    const onDone = render();
    expect(screen.getByLabelText(/^Employee code/)).toHaveValue("6900012");
    expect(
      screen.getByText("Suggested next code. You can change it."),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText(/^Display name/), {
      target: { value: "Malee" },
    });
    expect(screen.getByRole("radio", { name: "Permanent" })).toBeChecked();
    fireEvent.click(screen.getByLabelText("On probation"));
    fireEvent.click(screen.getByRole("button", { name: "Save employee" }));
    const alert = { selector: "p[role=alert]" };
    expect(await screen.findByText("Choose a department", alert)).toBeVisible();
    expect(screen.getByText("Choose a position", alert)).toBeVisible();
    expect(screen.getByText("Enter the probation end date")).toBeVisible();
    expect(state.save).not.toHaveBeenCalled();

    chooseOption("Department *", "Sales");
    chooseOption("Position *", "General staff");
    chooseOption("Level", "CEO");
    chooseOption("Branch", "HQ");
    fireEvent.change(screen.getByLabelText(/^Probation end date/), {
      target: { value: "2027-01-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save employee" }));
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    expect(state.save.mock.calls[0]![0]).toMatchObject({
      replaceOrgFields: true,
      code: "6900012",
      displayName: "Malee",
      warehouseId: "w1",
      departmentId: "d1",
      positionId: "p3",
      levelId: "l1",
      branchId: "b1",
      employmentType: "PERMANENT",
      probationEndDate: "2027-01-31",
    });
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ employeeId: "e9" }),
    );
  });

  it("does not require masters the organization has not set up, and keeps a typed code", () => {
    state.queries.set(getFunctionName(hrRefs.departmentOptions), items([]));
    state.queries.set(getFunctionName(hrRefs.positionOptions), items([]));
    state.queries.set(getFunctionName(hrRefs.suggestEmployeeCode), {
      ok: true,
      requestId: "q",
      value: { ok: true, code: "6900012" },
    });
    render();
    const code = screen.getByLabelText(/^Employee code/);
    fireEvent.change(code, { target: { value: "EMP-1" } });
    expect(code).toHaveValue("EMP-1");
    expect(screen.getByLabelText("Department")).toBeInTheDocument();
    expect(screen.getByLabelText("Position")).toBeInTheDocument();
  });

  it("shows a refused org reference beside its field", async () => {
    state.save.mockResolvedValue({
      ok: true,
      value: {
        written: false,
        error: { code: "ORG_REFERENCE_UNAVAILABLE", field: "departmentId" },
      },
    });
    render(E001);
    fireEvent.click(screen.getByRole("button", { name: "Save employee" }));
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    expect(state.save.mock.calls[0]![0]).toMatchObject({
      replaceOrgFields: true,
      employeeId: "e1",
      expectedVersion: 4,
      departmentId: "d-old",
      positionId: "p3",
      employmentType: "FIXED_TERM",
      probationEndDate: "2024-05-07",
    });
    expect(
      (
        await screen.findAllByText(
          "This choice is inactive or no longer available",
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});

it("does not require a department or position for an inactive employee", async () => {
  state.save.mockResolvedValue({
    ok: true,
    value: { written: true, documentId: "e9", replayed: false },
  });
  render({
    ...E001,
    status: "INACTIVE",
    departmentId: undefined,
    departmentName: undefined,
    positionId: undefined,
    positionName: undefined,
  });
  expect(screen.getByLabelText("Department")).toBeInTheDocument();
  expect(screen.getByLabelText("Position")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save employee" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  expect(state.save.mock.calls[0]![0]).not.toHaveProperty("departmentId");
  expect(state.save.mock.calls[0]![0]).toMatchObject({ status: "INACTIVE" });
});

it("lets a legacy active employee without assignments save, but asks again on reactivation", async () => {
  state.save.mockResolvedValue({
    ok: true,
    value: { written: true, documentId: "e1", replayed: false },
  });
  const legacy = {
    ...E001,
    departmentId: undefined,
    departmentName: undefined,
    positionId: undefined,
    positionName: undefined,
  };
  render(legacy);
  expect(screen.getByLabelText("Department")).toBeInTheDocument();
  expect(screen.getByLabelText("Position")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save employee" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  expect(state.save.mock.calls[0]![0]).toMatchObject({
    employeeId: "e1",
    status: "ACTIVE",
  });
  expect(state.save.mock.calls[0]![0]).not.toHaveProperty("departmentId");
});

it("requires a department again when an inactive employee becomes active", () => {
  render({
    ...E001,
    status: "INACTIVE",
    departmentId: undefined,
    departmentName: undefined,
    positionId: undefined,
    positionName: undefined,
  });
  expect(screen.getByLabelText("Department")).toBeInTheDocument();
  chooseOption("Employment status", "Active");
  expect(screen.getByLabelText("Department *")).toBeInTheDocument();
  expect(screen.getByLabelText("Position *")).toBeInTheDocument();
});
