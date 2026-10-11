import { webcrypto } from "node:crypto";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode, ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  configuredEnvironment,
  renderWithIntl,
} from "@tests/fixtures/intl-render";
import { PAYSLIP_CSV_HEADER, pdfHash } from "../../../convex/model/hr/payslip";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  httpQuery: vi.fn(),
  httpMutation: vi.fn(),
  mutation: vi.fn(),
  getToken: vi.fn(),
  reverify: vi.fn(),
  clearAuth: vi.fn(),
  auth: { sessionId: "session-a", isSignedIn: true },
  access: {
    status: "READY",
    permissions: ["hr.self.access", "hr.admin.manage"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    today: "2026-10-12",
    identityKey: "org:user",
    sites: [],
  },
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    state.query(getFunctionName(ref), args),
  useMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      state.mutation(getFunctionName(ref), args),
}));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    setAuth() {}
    clearAuth() {
      state.clearAuth();
    }
    query(ref: Parameters<typeof getFunctionName>[0], args: unknown) {
      return state.httpQuery(getFunctionName(ref), args);
    }
    mutation(ref: Parameters<typeof getFunctionName>[0], args: unknown) {
      return state.httpMutation(getFunctionName(ref), args);
    }
  },
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ ...state.auth, getToken: state.getToken }),
  useReverification:
    (fetcher: (...args: unknown[]) => Promise<unknown>) =>
    async (...args: unknown[]) => {
      let result = await fetcher(...args);
      if (result && typeof result === "object" && "clerk_error" in result) {
        state.reverify(result);
        result = await fetcher(...args);
      }
      return result;
    },
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => state.access,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/hr/payslips",
}));

import { HrPayslipsScreen } from "./EmployeePayslipsScreen";
import { HrPayslipImportScreen } from "./PayslipImportScreen";
import { downloadPrivatePayslip, PayslipAccessError } from "./payslipClient";
import { preparePayslipImport } from "./payslipImport";
const envelope = (value: unknown) => ({ ok: true, value });
const row = {
  id: "statement",
  from: "2026-09-01",
  to: "2026-09-30",
  paymentDate: "2026-10-01",
  version: 1,
  publishedAt: 1,
  superseded: false,
};
const metadata = () => ({
  ok: true,
  item: row,
  verificationMinutes: 5,
  policyVersionId: "policy-1",
  capabilityAvailable: true,
});
const list = () => ({
  ...metadata(),
  items: [row],
  isDone: true,
  continueCursor: "",
});
const detail = () => ({
  written: true,
  documentId: "statement",
  gross: 3000000,
  deductions: 150000,
  net: 2850000,
  expiresAt: Date.now() + 60_000,
  policyVersionId: "policy-1",
});
const render = (ui: ReactElement) =>
  renderWithIntl(ui, {
    locale: "en",
    environment: configuredEnvironment,
    workspace: false,
    preserveProviders: true,
  });
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  state.query.mockReset();
  state.httpQuery.mockReset();
  state.httpMutation.mockReset();
  state.mutation.mockReset();
  state.getToken.mockReset().mockResolvedValue("fresh-provider-token");
  state.reverify.mockReset();
  state.clearAuth.mockReset();
  state.access.permissions = ["hr.self.access", "hr.admin.manage"];
  state.auth.sessionId = "session-a";
  state.auth.isSignedIn = true;
  state.query.mockReturnValue(envelope(list()));
  state.httpQuery.mockReturnValue(envelope(metadata()));
  state.httpMutation.mockReturnValue(envelope(detail()));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("initially reads metadata only and never requests sensitive amounts", () => {
  render(<HrPayslipsScreen />);
  expect(screen.getByText("Amounts hidden")).toBeInTheDocument();
  expect(screen.queryByText(/30,000/)).not.toBeInTheDocument();
  expect(state.httpQuery).not.toHaveBeenCalled();
  expect(state.httpMutation).not.toHaveBeenCalled();
  expect(
    state.query.mock.calls.every(([name]) => name === "hr/payslips:list"),
  ).toBe(true);
});
it("uses provider reverification and a fresh signed token, then clears amounts on hide", async () => {
  state.httpMutation
    .mockReturnValueOnce(
      envelope({ written: false, error: { code: "REVERIFICATION_REQUIRED" } }),
    )
    .mockReturnValue(envelope(detail()));
  render(<HrPayslipsScreen />);
  fireEvent.click(
    screen.getByRole("button", { name: "Verify and show amounts" }),
  );
  await screen.findByText(/30,000/);
  expect(state.reverify).toHaveBeenCalledWith({
    clerk_error: {
      type: "forbidden",
      reason: "reverification-error",
      metadata: { reverification: { level: "first_factor", afterMinutes: 5 } },
    },
  });
  expect(state.getToken).toHaveBeenCalledWith({
    template: "convex",
    skipCache: true,
  });
  expect(state.httpMutation.mock.calls[0]?.[1]).toEqual(
    state.httpMutation.mock.calls[1]?.[1],
  );
  expect(state.clearAuth).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Hide amounts" }));
  expect(screen.queryByText(/30,000/)).not.toBeInTheDocument();
});
it("discards a late sensitive response after the document becomes hidden", async () => {
  let resolve: (value: unknown) => void = () => {};
  state.httpMutation.mockReturnValue(
    new Promise((value) => {
      resolve = value;
    }),
  );
  render(<HrPayslipsScreen />);
  fireEvent.click(
    screen.getByRole("button", { name: "Verify and show amounts" }),
  );
  await waitFor(() => expect(state.httpMutation).toHaveBeenCalledTimes(1));
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  fireEvent(document, new Event("visibilitychange"));
  await act(async () => resolve(envelope(detail())));
  expect(screen.queryByText(/30,000/)).not.toBeInTheDocument();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  fireEvent(document, new Event("visibilitychange"));
  expect(screen.getByText("Amounts hidden")).toBeInTheDocument();
});
it("hides sensitive amounts immediately on a policy or account-session change", async () => {
  const view = render(<HrPayslipsScreen />);
  fireEvent.click(
    screen.getByRole("button", { name: "Verify and show amounts" }),
  );
  await screen.findByText(/30,000/);
  state.query.mockReturnValue(
    envelope({ ...list(), policyVersionId: "policy-2" }),
  );
  view.rerender(<HrPayslipsScreen />);
  expect(screen.queryByText(/30,000/)).not.toBeInTheDocument();
  state.auth.sessionId = "session-b";
  view.rerender(<HrPayslipsScreen />);
  expect(screen.getByText("Amounts hidden")).toBeInTheDocument();
});
it("expires exposed amounts at a future policy boundary even without another database update", async () => {
  vi.useFakeTimers();
  state.httpQuery.mockReturnValue(
    envelope({ ...metadata(), policyChangesAt: Date.now() + 2000 }),
  );
  render(<HrPayslipsScreen />);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Verify and show amounts" }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByText(/30,000/)).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(2001));
  expect(screen.queryByText(/30,000/)).not.toBeInTheDocument();
});
it("does not offer sensitive actions on a superseded statement", () => {
  state.query.mockReturnValue(
    envelope({ ...list(), items: [{ ...row, superseded: true }] }),
  );
  render(<HrPayslipsScreen />);
  expect(screen.getByText("Replaced by a newer version")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Verify and show amounts" }),
  ).not.toBeInTheDocument();
});
it("uses exact metadata for a notification-linked statement", () => {
  state.query.mockReturnValue(envelope(metadata()));
  render(<HrPayslipsScreen rowId="statement" />);
  expect(state.query).toHaveBeenCalledWith("hr/payslips:metadata", {
    rowId: "statement",
  });
  expect(state.httpMutation).not.toHaveBeenCalled();
});
it("refuses a tampered PDF before creating any downloadable object URL", async () => {
  const bytes = new TextEncoder().encode("%PDF-original");
  const create = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
  await expect(
    downloadPrivatePayslip(
      {
        base64: btoa("%PDF-tampered"),
        sha256: await pdfHash(bytes),
        expiresAt: Date.now() + 10000,
        fileName: "statement.pdf",
      },
      () => true,
    ),
  ).rejects.toBeInstanceOf(PayslipAccessError);
  expect(create).not.toHaveBeenCalled();
});
it("downloads the original verified PDF bytes and revokes its local URL", async () => {
  const bytes = new TextEncoder().encode("%PDF-original");
  const create = vi.fn(() => "blob:private");
  const revoke = vi.fn();
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  await downloadPrivatePayslip(
    {
      base64: btoa("%PDF-original"),
      sha256: await pdfHash(bytes),
      expiresAt: Date.now() + 10000,
      fileName: "statement.pdf",
    },
    () => true,
  );
  expect(create).toHaveBeenCalledTimes(1);
  expect(click).toHaveBeenCalledTimes(1);
  expect(revoke).toHaveBeenCalledWith("blob:private");
  click.mockRestore();
});
const file = (name: string, text: string): File =>
  ({
    name,
    size: new TextEncoder().encode(text).length,
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  }) as File;
const csv = `${PAYSLIP_CSV_HEADER}\nEMP-1,2026-09-01,2026-09-30,2026-10-01,30000.00,1500.00,28500.00`;
it("binds exact source PDF bytes to each CSV employee and rejects mismatched filenames", async () => {
  const pdf = file("EMP-1.pdf", "%PDF-exact-source");
  const prepared = await preparePayslipImport(
    file("source.csv", csv),
    [pdf],
    "2026-09-01",
    "2026-09-30",
  );
  expect(prepared.rows[0]?.net).toBe(2850000);
  expect(prepared.documents[0]?.base64).toBe(btoa("%PDF-exact-source"));
  expect(prepared.documents[0]?.expectedHash).toBe(
    await pdfHash(new TextEncoder().encode("%PDF-exact-source")),
  );
  await expect(
    preparePayslipImport(
      file("source.csv", csv),
      [file("OTHER.pdf", "%PDF-exact-source")],
      "2026-09-01",
      "2026-09-30",
    ),
  ).rejects.toThrow("PAYSLIP_DOCUMENT_MAPPING_INVALID");
});
it("refuses arithmetic mismatches before staging any files", async () => {
  await expect(
    preparePayslipImport(
      file("source.csv", csv.replace("28500.00", "28600.00")),
      [file("EMP-1.pdf", "%PDF-source")],
      "2026-09-01",
      "2026-09-30",
    ),
  ).rejects.toThrow("PAYSLIP_CSV_INVALID");
});
it("keeps publication separate and requires explicit replacement review", async () => {
  state.query.mockReturnValue(
    envelope({
      ok: true,
      items: [
        {
          id: "batch",
          from: row.from,
          to: row.to,
          sourceName: "Payroll September",
          sourceHash: "sourcehash",
          status: "STAGED",
          rowCount: 1,
          rows: [
            {
              employeeCode: "EMP-1",
              employeeName: "Employee",
              gross: 3000000,
              deductions: 150000,
              net: 2850000,
              sourceHash: "pdfhash",
            },
          ],
        },
      ],
      isDone: true,
      continueCursor: "",
      hashRequired: true,
    }),
  );
  state.mutation.mockResolvedValue(
    envelope({ written: true, documentId: "batch" }),
  );
  render(<HrPayslipImportScreen />);
  const publish = screen.getByRole("button", {
    name: "Publish reviewed batch",
  });
  expect(publish).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/I reviewed replacements/));
  fireEvent.click(publish);
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(1));
  expect(state.mutation.mock.calls[0]?.[0]).toBe("hr/payslips:publish");
  expect(state.mutation.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({ importId: "batch", replacementConfirmed: true }),
  );
});

it("stages verified source files without publishing and retries the exact uncertain command", async () => {
  state.query.mockReturnValue(
    envelope({
      ok: true,
      items: [],
      isDone: true,
      continueCursor: "",
      hashRequired: true,
    }),
  );
  state.mutation
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockResolvedValue(envelope({ written: true, documentId: "batch" }));
  render(<HrPayslipImportScreen />);
  fireEvent.change(screen.getByLabelText(/Source name/), {
    target: { value: "Payroll September" },
  });
  fireEvent.change(screen.getByLabelText(/Period start/), {
    target: { value: "2026-09-01" },
  });
  fireEvent.change(screen.getByLabelText(/Period end/), {
    target: { value: "2026-09-30" },
  });
  fireEvent.change(screen.getByLabelText(/Payroll CSV/), {
    target: { files: [file("source.csv", csv)] },
  });
  fireEvent.change(screen.getByLabelText(/PDF documents/), {
    target: { files: [file("EMP-1.pdf", "%PDF-source")] },
  });
  await screen.findByLabelText("Include row 2 · EMP-1");
  fireEvent.click(screen.getByRole("button", { name: "Validate files" }));
  await screen.findByText(/1 verified row/);
  expect(
    screen.getByRole("button", { name: "Stage verified import" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/I verified these source amounts/));
  fireEvent.click(
    screen.getByRole("button", { name: "Stage verified import" }),
  );
  const uncertain = await screen.findByTestId("hr-write-uncertain");
  expect(state.mutation).toHaveBeenCalledTimes(1);
  expect(state.mutation.mock.calls[0]?.[0]).toBe("hr/payslips:stage");
  const command = state.mutation.mock.calls[0];
  fireEvent.click(uncertain.querySelector("button")!);
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(2));
  expect(state.mutation.mock.calls[1]).toEqual(command);
  expect(
    state.mutation.mock.calls.every(([name]) => name === "hr/payslips:stage"),
  ).toBe(true);
});
it("rejects over-size PDFs and duplicate employee documents before staging", async () => {
  const tooLarge = {
    ...file("EMP-1.pdf", "%PDF-source"),
    size: 384 * 1024 + 1,
  };
  await expect(
    preparePayslipImport(
      file("source.csv", csv),
      [tooLarge],
      "2026-09-01",
      "2026-09-30",
    ),
  ).rejects.toThrow("PAYSLIP_DOCUMENT_MAPPING_INVALID");
  await expect(
    preparePayslipImport(
      file("source.csv", csv),
      [file("EMP-1.pdf", "%PDF-a"), file("EMP-1.pdf", "%PDF-b")],
      "2026-09-01",
      "2026-09-30",
    ),
  ).rejects.toThrow("PAYSLIP_DOCUMENT_MAPPING_INVALID");
});

const withInvalidRow = `${csv}\nEMP-2,2026-09-01,2026-09-30,2026-10-01,,0.00,0.00`;
it("retains the original source and includes only explicitly selected employee documents", async () => {
  const prepared = await preparePayslipImport(
    file("source.csv", withInvalidRow),
    [file("EMP-1.pdf", "%PDF-one"), file("EMP-2.pdf", "%PDF-excluded")],
    row.from,
    row.to,
    [
      {
        rowNumber: 3,
        reason: "Missing original amounts; payroll will correct source",
      },
    ],
  );
  expect(prepared.csv).toBe(withInvalidRow);
  expect(prepared.rows).toHaveLength(1);
  expect(prepared.documents.map((document) => document.employeeCode)).toEqual([
    "EMP-1",
  ]);
  expect(prepared.exclusions).toEqual([
    {
      rowNumber: 3,
      employeeCode: "EMP-2",
      reason: "Missing original amounts; payroll will correct source",
    },
  ]);
  await expect(
    preparePayslipImport(
      file("source.csv", withInvalidRow),
      [file("EMP-1.pdf", "%PDF-one")],
      row.from,
      row.to,
    ),
  ).rejects.toThrow("PAYSLIP_CSV_INVALID");
  await expect(
    preparePayslipImport(
      file("source.csv", withInvalidRow),
      [file("EMP-1.pdf", "%PDF-one")],
      row.from,
      row.to,
      [{ rowNumber: 3, reason: "x" }],
    ),
  ).rejects.toThrow("CSV_EXCLUSIONS_INVALID");
});
function importFixture() {
  state.query.mockReturnValue(
    envelope({
      ok: true,
      items: [],
      isDone: true,
      continueCursor: "",
      hashRequired: true,
    }),
  );
  render(<HrPayslipImportScreen />);
  fireEvent.change(screen.getByLabelText(/Source name/), {
    target: { value: "Payroll September" },
  });
  fireEvent.change(screen.getByLabelText(/Period start/), {
    target: { value: row.from },
  });
  fireEvent.change(screen.getByLabelText(/Period end/), {
    target: { value: row.to },
  });
  fireEvent.change(screen.getByLabelText(/Payroll CSV/), {
    target: { files: [file("source.csv", withInvalidRow)] },
  });
  fireEvent.change(screen.getByLabelText(/PDF documents/), {
    target: { files: [file("EMP-1.pdf", "%PDF-one")] },
  });
}
it("shows invalid source rows included by default and invalidates previews when row selection changes", async () => {
  importFixture();
  const invalid = await screen.findByLabelText("Include row 3 · EMP-2");
  expect(invalid).toBeChecked();
  expect(screen.getByText("Invalid source row")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Validate files" }));
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("button", { name: "Stage verified import" }),
  ).not.toBeInTheDocument();
  expect(state.mutation).not.toHaveBeenCalled();
  fireEvent.click(invalid);
  fireEvent.change(screen.getByLabelText(/Reason for excluding row 3/), {
    target: { value: "Await payroll correction" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Validate files" }));
  await screen.findByText(/1 verified row/);
  fireEvent.click(screen.getByLabelText(/I verified these source amounts/));
  expect(
    screen.getByRole("button", { name: "Stage verified import" }),
  ).toBeEnabled();
  fireEvent.change(screen.getByLabelText(/Reason for excluding row 3/), {
    target: { value: "Updated correction reason" },
  });
  expect(
    screen.queryByRole("button", { name: "Stage verified import" }),
  ).not.toBeInTheDocument();
  expect(state.mutation).not.toHaveBeenCalled();
});
it("stages explicit exclusions with original row numbers and retries their exact uncertain payload", async () => {
  state.mutation
    .mockRejectedValueOnce(new Error("Lost receipt"))
    .mockResolvedValue(envelope({ written: true, documentId: "batch" }));
  importFixture();
  fireEvent.click(await screen.findByLabelText("Include row 3 · EMP-2"));
  fireEvent.change(screen.getByLabelText(/Reason for excluding row 3/), {
    target: { value: "Await payroll correction" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Validate files" }));
  await screen.findByText(/1 verified row/);
  fireEvent.click(screen.getByLabelText(/I verified these source amounts/));
  fireEvent.click(
    screen.getByRole("button", { name: "Stage verified import" }),
  );
  const uncertain = await screen.findByTestId("hr-write-uncertain");
  expect(screen.getByLabelText("Include row 3 · EMP-2")).toBeDisabled();
  expect(screen.getByLabelText(/Reason for excluding row 3/)).toBeDisabled();
  expect(state.mutation.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({
      csv: withInvalidRow,
      exclusions: [{ rowNumber: 3, reason: "Await payroll correction" }],
      documents: [expect.objectContaining({ employeeCode: "EMP-1" })],
    }),
  );
  fireEvent.click(uncertain.querySelector("button")!);
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(2));
  expect(state.mutation.mock.calls[1]).toEqual(state.mutation.mock.calls[0]);
});
it("a replacement source clears old exclusions and validated rows", async () => {
  importFixture();
  fireEvent.click(await screen.findByLabelText("Include row 3 · EMP-2"));
  fireEvent.change(screen.getByLabelText(/Reason for excluding row 3/), {
    target: { value: "Await payroll correction" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Validate files" }));
  await screen.findByText(/1 verified row/);
  fireEvent.change(screen.getByLabelText(/Payroll CSV/), {
    target: { files: [file("replacement.csv", csv)] },
  });
  await screen.findByLabelText("Include row 2 · EMP-1");
  expect(
    screen.queryByLabelText(/Reason for excluding row 3/),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Stage verified import" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/1 verified row/)).not.toBeInTheDocument();
});
it("retains excluded source rows and reasons in the staged batch review", () => {
  state.query.mockReturnValue(
    envelope({
      ok: true,
      items: [
        {
          id: "batch",
          from: row.from,
          to: row.to,
          sourceName: "Payroll September",
          sourceHash: "hash",
          status: "STAGED",
          rowCount: 1,
          rows: [],
          exclusions: [
            {
              rowNumber: 3,
              employeeCode: "EMP-2",
              reason: "Await payroll correction",
            },
          ],
        },
      ],
      isDone: true,
      continueCursor: "",
      hashRequired: true,
    }),
  );
  render(<HrPayslipImportScreen />);
  fireEvent.click(
    screen.getByText("Review employee amounts and source fingerprints"),
  );
  expect(screen.getByText("Row 3 · EMP-2 · excluded")).toBeVisible();
  expect(screen.getByText("Await payroll correction")).toBeVisible();
});
it("refuses a selection that excludes every original row", async () => {
  await expect(
    preparePayslipImport(file("source.csv", csv), [], row.from, row.to, [
      { rowNumber: 2, reason: "Missing payroll approval" },
    ]),
  ).rejects.toThrow("CSV_EXCLUSIONS_INVALID");
});
