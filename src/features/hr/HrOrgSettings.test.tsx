import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { useSyncExternalStore, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  identityKey: "org-a:user-a",
}));
vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) => {
      if (args === "skip") return undefined;
      const key = name(reference);
      if (key === "hr/policies:current") return undefined;
      return (
        state.queries.get(key) ?? {
          ok: true,
          requestId: "query",
          value: {
            ok: true,
            provisioned: true,
            status: "ready",
            page: [],
            items: [],
            continueCursor: "",
            isDone: true,
            complete: true,
          },
        }
      );
    },
    useMutation: (reference: Parameters<typeof name>[0]) => {
      const key = name(reference);
      if (!state.mutations.has(key)) state.mutations.set(key, vi.fn());
      return state.mutations.get(key);
    },
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.admin.manage"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    today: "2026-10-20",
    identityKey: state.identityKey,
    sites: [{ id: "w1", code: "HQ", name: "Head office" }],
  }),
  useHrCan: () => true,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const query = useSyncExternalStore(
      (listener) => {
        window.addEventListener("app-query-state", listener);
        window.addEventListener("popstate", listener);
        return () => {
          window.removeEventListener("app-query-state", listener);
          window.removeEventListener("popstate", listener);
        };
      },
      () => window.location.search,
    );
    return new URLSearchParams(query);
  },
}));
vi.mock("@/i18n/navigation", () => {
  function navigate(href: string, mode: "pushState" | "replaceState") {
    window.history[mode]({}, "", `/en${href}`);
    window.dispatchEvent(new Event("app-query-state"));
  }
  const router = {
    push: (href: string) => navigate(href, "pushState"),
    replace: (href: string) => navigate(href, "replaceState"),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
  };
  return {
    Link: (props: ComponentProps<"a">) => <a {...props} />,
    useRouter: () => router,
  };
});

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { appHistoryIndex, trackAppHistory } from "@/lib/browser/appHistory";
import { hrRefs } from "@/lib/convex/hrApi";

import { HrSettingsScreen } from "./SettingsScreen";

const hq = {
  id: "b1",
  name: "HQ",
  revenueBranchNo: "00000",
  ssoEmployerAccount: "10-0000001",
  type: "HEAD_OFFICE",
  address: "1 Silom Road",
  province: "Bangkok",
  district: "Bang Rak",
  subDistrict: "Silom",
  postcode: "10500",
  status: "ACTIVE",
  version: 3,
};
const company = {
  id: "c1",
  name: "Siam Industrial",
  nameEn: "Siam Industrial Co., Ltd.",
  taxId: "0105500000001",
  address: "1 Silom Road",
  province: "Bangkok",
  district: "Bang Rak",
  subDistrict: "Silom",
  postcode: "10500",
  bankAccounts: [{ bankName: "KBank", accountNo: "123-4-56789-0" }],
  hasLogo: true,
  version: 2,
};
const saved = (documentId: string) => ({
  ok: true,
  value: { written: true, documentId, replayed: false },
});
const refused = (code: string, field: string) => ({
  ok: true,
  value: { written: false, error: { code, field } },
});
const query = (value: unknown) => ({ ok: true, requestId: "query", value });
const mutation = (reference: Parameters<typeof getFunctionName>[0]) => {
  const key = getFunctionName(reference);
  if (!state.mutations.has(key)) state.mutations.set(key, vi.fn());
  return state.mutations.get(key)!;
};

let stopTracking: () => void;
let actor = 0;
beforeEach(() => {
  state.identityKey = `org-a:user-${++actor}`;
  state.queries.clear();
  state.mutations.clear();
  window.sessionStorage.clear();
  state.queries.set(
    getFunctionName(hrRefs.companyProfile),
    query({ profile: company }),
  );
  state.queries.set(getFunctionName(hrRefs.companyLogo), query(null));
  state.queries.set(
    getFunctionName(hrRefs.listBranches),
    query({ items: [hq] }),
  );
  state.queries.set(
    getFunctionName(hrRefs.listDepartments),
    query({
      items: [
        { id: "d1", name: "Sales", status: "ACTIVE", version: 1 },
        {
          id: "d2",
          name: "Recruitment",
          status: "INACTIVE",
          managerEmployeeId: "e2",
          version: 1,
        },
      ],
    }),
  );
  state.queries.set(
    getFunctionName(hrRefs.listPositions),
    query({ items: [] }),
  );
  state.queries.set(getFunctionName(hrRefs.listLevels), query({ items: [] }));
  state.queries.set(
    getFunctionName(hrRefs.employee),
    query({
      ok: true,
      employee: { id: "e2", code: "E002", displayName: "Malee" },
    }),
  );
  window.history.replaceState({ appNavigationIndex: 0 }, "", "/en/hr/today");
  stopTracking = trackAppHistory();
});
afterEach(() => stopTracking());

/** A field label, with or without its required marker. */
const field = (text: string) => (label: string) =>
  label === text || label === `${text} *`;
const here = () =>
  window.location.pathname + window.location.search + window.location.hash;
function openSettings(url = "/en/hr/settings?section=branches#org") {
  window.history.pushState({}, "", url);
  return renderWithIntl(
    <DraftGuardProvider>
      <main>
        <HrSettingsScreen />
      </main>
    </DraftGuardProvider>,
    { locale: "en", workspace: false, preserveProviders: true },
  );
}
async function traverse(delta: "back" | "forward") {
  await act(async () => {
    window.history[delta]();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  });
}
const branchDialog = (name = "Add branch") =>
  screen.findByRole("dialog", { name });

it("Add branch -> explicit Cancel -> next Back returns to the settings caller", async () => {
  openSettings();
  fireEvent.click(screen.getByRole("button", { name: "Add branch" }));
  const editor = await branchDialog();
  expect(
    within(editor).getByLabelText(field("Revenue Department branch number")),
  ).toBeVisible();
  expect(
    within(editor).getByLabelText(field("Social Security employer account")),
  ).toBeVisible();
  expect(
    within(editor).getByRole("group", { name: "Branch type" }),
  ).toBeVisible();
  expect(within(editor).getByLabelText("Active")).toBeChecked();
  fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(here()).toBe("/en/hr/settings?section=branches#org"),
  );
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
});

it("a dirty branch draft asks before Cancel or native Back discard it, and Keep editing retains it", async () => {
  openSettings();
  fireEvent.click(screen.getByRole("button", { name: "Add branch" }));
  const editor = await branchDialog();
  fireEvent.change(within(editor).getByLabelText(field("Branch name")), {
    target: { value: "Rayong" },
  });
  await traverse("back");
  await screen.findByRole("dialog", { name: "Discard changes?" });
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Discard changes?" }),
    ).toBeNull(),
  );
  expect(screen.getByLabelText(field("Branch name"))).toHaveValue("Rayong");
  fireEvent.click(
    within(await branchDialog()).getByRole("button", { name: "Cancel" }),
  );
  await screen.findByRole("dialog", { name: "Discard changes?" });
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(here()).toBe("/en/hr/settings?section=branches#org"),
  );
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
  expect(mutation(hrRefs.saveBranch)).not.toHaveBeenCalled();
});

it("native Back closes a clean branch editor and Forward reopens the same branch", async () => {
  openSettings();
  fireEvent.click(screen.getByRole("button", { name: "Edit branch HQ" }));
  await branchDialog("Edit branch");
  await traverse("back");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(here()).toBe("/en/hr/settings?section=branches#org");
  await traverse("forward");
  const editor = await branchDialog("Edit branch");
  expect(within(editor).getByLabelText(field("Branch name"))).toHaveValue("HQ");
  fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
});

it("a saved branch consumes its dialog entry before the next Back reaches the caller", async () => {
  const save = mutation(hrRefs.saveBranch);
  save.mockResolvedValue(saved("b1"));
  openSettings();
  fireEvent.click(screen.getByRole("button", { name: "Edit branch HQ" }));
  const editor = await branchDialog("Edit branch");
  expect(within(editor).getByLabelText(field("Branch name"))).toHaveValue("HQ");
  fireEvent.change(within(editor).getByLabelText(field("Branch name")), {
    target: { value: "Head office" },
  });
  fireEvent.click(within(editor).getByRole("button", { name: "Save branch" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      branchId: "b1",
      expectedVersion: 3,
      name: "Head office",
      revenueBranchNo: "00000",
      ssoEmployerAccount: "10-0000001",
      type: "HEAD_OFFICE",
      status: "ACTIVE",
    }),
  );
  await waitFor(() =>
    expect(here()).toBe("/en/hr/settings?section=branches#org"),
  );
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
});

it("a direct ?section=branches link focuses Branches and Cancel keeps the link without a synthetic parent", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/hr/settings?section=branches&keep=1#org",
  );
  renderWithIntl(
    <DraftGuardProvider>
      <main>
        <HrSettingsScreen />
      </main>
    </DraftGuardProvider>,
    { locale: "en", workspace: false },
  );
  await waitFor(() =>
    expect(document.activeElement?.id).toBe("hr-settings-branches"),
  );
  expect(screen.getByRole("table", { name: "Branches" })).toHaveTextContent(
    "HQ",
  );
  fireEvent.click(screen.getByRole("button", { name: "Add branch" }));
  fireEvent.click(
    within(await branchDialog()).getByRole("button", { name: "Cancel" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(here()).toBe("/en/hr/settings?section=branches&keep=1#org"),
  );
  expect(appHistoryIndex()).toBe(0);
});

it("the branch editor checks codes and maps a taken branch number to its field", async () => {
  const save = mutation(hrRefs.saveBranch);
  save.mockResolvedValue(refused("REVENUE_BRANCH_NO_TAKEN", "revenueBranchNo"));
  openSettings();
  fireEvent.click(screen.getByRole("button", { name: "Add branch" }));
  const editor = await branchDialog();
  const fill = (label: ReturnType<typeof field>, value: string) =>
    fireEvent.change(within(editor).getByLabelText(label), {
      target: { value },
    });
  fill(field("Branch name"), "Rayong");
  fill(field("Revenue Department branch number"), "12");
  fill(field("Social Security employer account"), "10-0000002");
  fill(field("Address"), "9 Sukhumvit");
  fill(field("Province"), "Rayong");
  fill(field("District"), "Mueang");
  fill(field("Sub-district"), "Tha Pradu");
  fill(field("Postcode"), "21000");
  fireEvent.click(within(editor).getByRole("button", { name: "Save branch" }));
  expect(await within(editor).findByText("Enter 5 digits")).toBeVisible();
  expect(save).not.toHaveBeenCalled();
  fill(field("Revenue Department branch number"), "00000");
  fireEvent.click(within(editor).getByRole("radio", { name: "Head office" }));
  fireEvent.click(within(editor).getByRole("button", { name: "Save branch" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0]).toMatchObject({
    revenueBranchNo: "00000",
    type: "HEAD_OFFICE",
    status: "ACTIVE",
  });
  expect(
    (
      await within(editor).findAllByText(
        "Another branch already uses this branch number",
      )
    ).length,
  ).toBeGreaterThan(0);
  expect(screen.getByRole("dialog", { name: "Add branch" })).toBeVisible();
});

it("Add department -> explicit Cancel -> next Back returns to the settings caller", async () => {
  openSettings("/en/hr/settings?section=organization");
  expect(screen.getByText("No positions yet")).toBeVisible();
  expect(screen.getByText("No levels yet")).toBeVisible();
  expect(screen.getByText("Manager: Malee")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Add department" }));
  const editor = await screen.findByRole("dialog", { name: "Add department" });
  expect(within(editor).getByLabelText("Responsible manager")).toBeVisible();
  fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(here()).toBe("/en/hr/settings?section=organization"),
  );
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
});

it("a saved level consumes its dialog entry before the next Back reaches the caller", async () => {
  const save = mutation(hrRefs.saveLevel);
  save.mockResolvedValue(saved("l1"));
  openSettings("/en/hr/settings?section=organization");
  fireEvent.click(screen.getByRole("button", { name: "Add level" }));
  const editor = await screen.findByRole("dialog", { name: "Add level" });
  fireEvent.change(within(editor).getByLabelText(field("Level name")), {
    target: { value: "CEO" },
  });
  fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
  expect(await within(editor).findByText("Enter a whole number")).toBeVisible();
  fireEvent.change(within(editor).getByLabelText(field("Sort order")), {
    target: { value: "1" },
  });
  fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ name: "CEO", sortOrder: 1, status: "ACTIVE" }),
  );
  await waitFor(() =>
    expect(here()).toBe("/en/hr/settings?section=organization"),
  );
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
});

it("an inactive department reopens with its state and saves the toggle", async () => {
  const save = mutation(hrRefs.saveDepartment);
  save.mockResolvedValue(saved("d2"));
  openSettings("/en/hr/settings?section=organization");
  fireEvent.click(
    screen.getByRole("button", { name: "Edit department Recruitment" }),
  );
  const editor = await screen.findByRole("dialog", { name: "Edit department" });
  const active = within(editor).getByLabelText("Active");
  expect(active).not.toBeChecked();
  fireEvent.click(active);
  fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0]).toMatchObject({
    departmentId: "d2",
    expectedVersion: 1,
    name: "Recruitment",
    managerEmployeeId: "e2",
    status: "ACTIVE",
  });
});

it("company profile shows its fields and adds and removes bank accounts", () => {
  openSettings("/en/hr/settings?section=company");
  const form = screen.getByRole("form", { name: "Company profile" });
  expect(within(form).getByLabelText(field("Company name"))).toHaveValue(
    "Siam Industrial",
  );
  expect(within(form).getByLabelText(field("Tax ID"))).toHaveValue(
    "0105500000001",
  );
  for (const label of [
    field("Address"),
    field("Address (English)"),
    field("Province"),
    field("District"),
    field("Sub-district"),
    field("Postcode"),
    field("Phone"),
    field("Fax"),
    field("Company logo"),
  ])
    expect(within(form).getByLabelText(label)).toBeInTheDocument();
  const accounts = within(form).getByRole("group", { name: "Bank accounts" });
  expect(
    within(accounts).getAllByLabelText(field("Account number")),
  ).toHaveLength(1);
  fireEvent.click(
    within(accounts).getByRole("button", { name: "Add account" }),
  );
  expect(
    within(accounts).getAllByLabelText(field("Account number")),
  ).toHaveLength(2);
  fireEvent.click(
    within(accounts).getByRole("button", { name: "Remove account 2" }),
  );
  expect(
    within(accounts).getAllByLabelText(field("Account number")),
  ).toHaveLength(1);
});

it("company profile guards unsaved edits and maps a refused tax ID to its field", async () => {
  const save = mutation(hrRefs.saveCompanyProfile);
  save.mockResolvedValue(refused("TAX_ID_INVALID", "taxId"));
  openSettings("/en/hr/settings?section=company");
  const form = screen.getByRole("form", { name: "Company profile" });
  const taxId = within(form).getByLabelText(field("Tax ID"));
  fireEvent.change(taxId, { target: { value: "123" } });
  fireEvent.click(
    within(form).getByRole("button", { name: "Save company profile" }),
  );
  expect(
    await within(form).findByText("Enter the 13-digit tax ID"),
  ).toBeVisible();
  expect(save).not.toHaveBeenCalled();

  fireEvent.change(taxId, { target: { value: "0105500000002" } });
  fireEvent.click(
    within(form).getByRole("button", { name: "Save company profile" }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0]).toMatchObject({
    expectedVersion: 2,
    name: "Siam Industrial",
    taxId: "0105500000002",
    bankAccounts: [{ bankName: "KBank", accountNo: "123-4-56789-0" }],
  });
  expect(
    (await within(form).findAllByText("Enter the 13-digit tax ID")).length,
  ).toBeGreaterThan(0);

  await traverse("back");
  await screen.findByRole("dialog", { name: "Discard changes?" });
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
});

it("choosing Head office fills an empty branch number but keeps a typed one, and a mismatch is explained", async () => {
  const save = mutation(hrRefs.saveBranch);
  save.mockResolvedValue(refused("BRANCH_TYPE_MISMATCH", "type"));
  openSettings();
  fireEvent.click(screen.getByRole("button", { name: "Add branch" }));
  const editor = await branchDialog();
  const number = within(editor).getByLabelText(
    field("Revenue Department branch number"),
  );
  fireEvent.click(within(editor).getByRole("radio", { name: "Head office" }));
  expect(number).toHaveValue("00000");
  fireEvent.change(number, { target: { value: "00012" } });
  fireEvent.click(within(editor).getByRole("radio", { name: "Branch" }));
  fireEvent.click(within(editor).getByRole("radio", { name: "Head office" }));
  expect(number).toHaveValue("00012");
  const fill = (label: string, value: string) =>
    fireEvent.change(within(editor).getByLabelText(field(label)), {
      target: { value },
    });
  fill("Branch name", "Rayong");
  fill("Social Security employer account", "10-0000002");
  fill("Address", "9 Sukhumvit");
  fill("Province", "Rayong");
  fill("District", "Mueang");
  fill("Sub-district", "Tha Pradu");
  fill("Postcode", "21000");
  fireEvent.click(within(editor).getByRole("button", { name: "Save branch" }));
  const mismatch =
    "A head office uses branch number 00000; other branches use another number";
  expect(await within(editor).findByText(mismatch)).toBeVisible();
  expect(save).not.toHaveBeenCalled();
  // The server's answer is mapped to the same field.
  fireEvent.click(within(editor).getByRole("radio", { name: "Branch" }));
  fireEvent.click(within(editor).getByRole("button", { name: "Save branch" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect((await within(editor).findAllByText(mismatch)).length).toBeGreaterThan(
    0,
  );
});

it("company logo previews the stored image even before the first profile save, checks size and type, and saves or removes it on its own", async () => {
  const save = mutation(hrRefs.saveCompanyLogo);
  save.mockResolvedValue(saved("logo-1"));
  state.queries.set(
    getFunctionName(hrRefs.companyProfile),
    query({ profile: null }),
  );
  state.queries.set(
    getFunctionName(hrRefs.companyLogo),
    query({
      mimeType: "image/png",
      base64: "iVBORw0KGgo=",
      revision: { id: "logo-1", version: 1 },
    }),
  );
  openSettings("/en/hr/settings?section=company");
  const form = screen.getByRole("form", { name: "Company profile" });
  expect(
    within(form).getByRole("img", { name: "Current company logo" }),
  ).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
  const input = within(form).getByLabelText(field("Company logo"));
  const choose = (file: File) =>
    fireEvent.change(input, { target: { files: [file] } });
  choose(new File(["GIF89a"], "logo.gif", { type: "image/gif" }));
  expect(
    await within(form).findByText("Choose a PNG, JPEG or WebP image"),
  ).toBeVisible();
  choose(
    new File([new Uint8Array(256 * 1024 + 1)], "big.png", {
      type: "image/png",
    }),
  );
  expect(
    await within(form).findByText("The logo must be 256 KB or smaller"),
  ).toBeVisible();
  expect(save).not.toHaveBeenCalled();

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  choose(new File([png], "logo.png", { type: "image/png" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0]).toMatchObject({
    mimeType: "image/png",
    base64: "iVBORw0KGgo=",
    expectedRevision: { id: "logo-1", version: 1 },
  });
  fireEvent.click(within(form).getByRole("button", { name: "Remove logo" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]![0]).toMatchObject({ remove: true });
  expect(save.mock.calls[1]![0]).not.toHaveProperty("base64");
});

function settingsTree() {
  return (
    <DraftGuardProvider>
      <main>
        <HrSettingsScreen />
      </main>
    </DraftGuardProvider>
  );
}
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};

it("a branch edited elsewhere while open is saved against the opened version and reported as stale", async () => {
  const save = mutation(hrRefs.saveBranch);
  save.mockResolvedValue({
    ok: true,
    value: { written: false, error: { code: "BRANCH_STALE" } },
  });
  window.history.pushState({}, "", "/en/hr/settings?section=branches#org");
  const view = renderWithIntl(settingsTree(), {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "Edit branch HQ" }));
  const editor = await branchDialog("Edit branch");
  fireEvent.change(within(editor).getByLabelText(field("Branch name")), {
    target: { value: "Head office" },
  });
  // Another administrator saves the branch while this editor is open.
  state.queries.set(
    getFunctionName(hrRefs.listBranches),
    query({ items: [{ ...hq, name: "HQ (renamed)", version: 4 }] }),
  );
  view.rerender(settingsTree());
  expect(within(editor).getByLabelText(field("Branch name"))).toHaveValue(
    "Head office",
  );
  fireEvent.click(within(editor).getByRole("button", { name: "Save branch" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0]).toMatchObject({
    branchId: "b1",
    expectedVersion: 3,
    name: "Head office",
  });
  expect(
    await within(editor).findByText(
      "Someone else changed this branch. Reopen it",
    ),
  ).toBeVisible();
  expect(screen.getByRole("dialog", { name: "Edit branch" })).toBeVisible();
});

it.each(["branch", "department"] as const)(
  "a pending %s save blocks native Back and Cancel until it settles, then consumes its dialog",
  async (kind) => {
    const pending = deferred();
    const save = mutation(
      kind === "branch" ? hrRefs.saveBranch : hrRefs.saveDepartment,
    );
    save.mockReturnValue(pending.promise);
    openSettings(
      kind === "branch"
        ? "/en/hr/settings?section=branches#org"
        : "/en/hr/settings?section=organization#org",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: kind === "branch" ? "Edit branch HQ" : "Edit department Sales",
      }),
    );
    const name = kind === "branch" ? "Edit branch" : "Edit department";
    const editor = await screen.findByRole("dialog", { name });
    fireEvent.click(
      within(editor).getByRole("button", {
        name: kind === "branch" ? "Save branch" : "Save",
      }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(
      within(editor).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    await traverse("back");
    expect(screen.getByRole("dialog", { name })).toBeVisible();
    expect(window.location.pathname).toBe("/en/hr/settings");
    await act(async () => pending.resolve(saved("x")));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(window.location.hash).toBe("#org"));
    await traverse("back");
    await waitFor(() => expect(here()).toBe("/en/hr/today"));
  },
);

it("a dirty department draft asks before native Back discards it, and Discard consumes only the dialog", async () => {
  openSettings("/en/hr/settings?section=organization#org");
  fireEvent.click(screen.getByRole("button", { name: "Add department" }));
  const editor = await screen.findByRole("dialog", { name: "Add department" });
  fireEvent.change(within(editor).getByLabelText(field("Department name")), {
    target: { value: "Logistics" },
  });
  await traverse("back");
  await screen.findByRole("dialog", { name: "Discard changes?" });
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Discard changes?" }),
    ).toBeNull(),
  );
  expect(screen.getByLabelText(field("Department name"))).toHaveValue(
    "Logistics",
  );
  await traverse("back");
  await screen.findByRole("dialog", { name: "Discard changes?" });
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(here()).toBe("/en/hr/settings?section=organization#org"),
  );
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
  expect(mutation(hrRefs.saveDepartment)).not.toHaveBeenCalled();
});

it("native Back closes a clean department editor and Forward reopens the same department", async () => {
  openSettings("/en/hr/settings?section=organization#org");
  fireEvent.click(
    screen.getByRole("button", { name: "Edit department Sales" }),
  );
  await screen.findByRole("dialog", { name: "Edit department" });
  await traverse("back");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(here()).toBe("/en/hr/settings?section=organization#org");
  await traverse("forward");
  const editor = await screen.findByRole("dialog", { name: "Edit department" });
  expect(within(editor).getByLabelText(field("Department name"))).toHaveValue(
    "Sales",
  );
  fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
});

it("the department editor shows a refused manager beside the manager field", async () => {
  const save = mutation(hrRefs.saveDepartment);
  save.mockResolvedValue(refused("MANAGER_UNAVAILABLE", "managerEmployeeId"));
  openSettings("/en/hr/settings?section=organization");
  fireEvent.click(
    screen.getByRole("button", { name: "Edit department Recruitment" }),
  );
  const editor = await screen.findByRole("dialog", { name: "Edit department" });
  // The current manager keeps its name though it is not on the shown page.
  expect(
    within(editor).getByLabelText("Responsible manager"),
  ).toHaveTextContent("Malee · E002");
  fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const message = "The manager is unavailable or outside your scope";
  expect(
    await within(editor).findByText(message, { selector: "p[role=alert]" }),
  ).toBeVisible();
});

it("logo intent pins the observed revision before file reading and query refresh; stale uploads stay selected until explicitly reapplied", async () => {
  const save = mutation(hrRefs.saveCompanyLogo);
  save
    .mockResolvedValueOnce(refused("LOGO_STALE", "expectedRevision"))
    .mockResolvedValue(saved("logo-1"));
  const revision = { id: "logo-1", version: 1 };
  const logo = { mimeType: "image/png", base64: "iVBORw0KGgo=", revision };
  state.queries.set(getFunctionName(hrRefs.companyLogo), query(logo));
  const view = openSettings("/en/hr/settings?section=company&keep=1#logo");
  const bytes = deferred();
  const file = new File(["png"], "my-selected.png", { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", { value: () => bytes.promise });
  fireEvent.change(screen.getByLabelText(field("Company logo")), {
    target: { files: [file] },
  });
  await traverse("back");
  expect(here()).toBe("/en/hr/settings?section=company&keep=1#logo");
  state.queries.set(
    getFunctionName(hrRefs.companyLogo),
    query({ ...logo, revision: { ...revision, version: 2 } }),
  );
  view.rerender(settingsTree());
  await act(async () =>
    bytes.resolve(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer,
    ),
  );
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0]).toMatchObject({ expectedRevision: revision });
  expect(
    await screen.findByText(/Another administrator changed the logo/),
  ).toBeVisible();
  expect(screen.getByText("Selected file: my-selected.png")).toBeVisible();
  await traverse("back");
  await screen.findByRole("dialog", { name: "Discard changes?" });
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Apply selected file to current logo" }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]![0]).toMatchObject({
    expectedRevision: { ...revision, version: 2 },
    base64: "iVBORw0KGgo=",
  });
  expect(save.mock.calls[1]![0].requestId).not.toBe(
    save.mock.calls[0]![0].requestId,
  );
  await waitFor(() =>
    expect(
      screen.queryByText("Selected file: my-selected.png"),
    ).not.toBeInTheDocument(),
  );
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
});

it("logo uncertain retry retains the removal snapshot across refresh and remount", async () => {
  const save = mutation(hrRefs.saveCompanyLogo);
  save
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValue(saved("logo-1"));
  const logo = {
    mimeType: "image/png",
    base64: "iVBORw0KGgo=",
    revision: { id: "logo-1", version: 3 },
  };
  state.queries.set(getFunctionName(hrRefs.companyLogo), query(logo));
  const view = openSettings("/en/hr/settings?section=company#logo");
  fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
  await screen.findByTestId("hr-write-uncertain");
  state.queries.set(
    getFunctionName(hrRefs.companyLogo),
    query({ ...logo, revision: { id: "logo-new", version: 1 } }),
  );
  view.unmount();
  renderWithIntl(settingsTree(), { locale: "en", workspace: false });
  fireEvent.click(screen.getByRole("button", { name: "Try again safely" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[0]![0]).toMatchObject({
    remove: true,
    expectedRevision: logo.revision,
  });
  expect(save.mock.calls[1]![0]).toEqual(save.mock.calls[0]![0]);
});

it.each(["header", "native"] as const)(
  "%s Back cannot abandon a pending logo removal after query refresh, then returns to its origin",
  async (kind) => {
    const save = mutation(hrRefs.saveCompanyLogo);
    const pending = deferred();
    save.mockReturnValue(pending.promise);
    const logo = {
      mimeType: "image/png",
      base64: "iVBORw0KGgo=",
      revision: { id: "logo-1", version: 1 },
    };
    state.queries.set(getFunctionName(hrRefs.companyLogo), query(logo));
    const view = openSettings("/en/hr/settings?section=company&keep=1#logo");
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    state.queries.set(
      getFunctionName(hrRefs.companyLogo),
      query({ ...logo, revision: { ...logo.revision, version: 2 } }),
    );
    view.rerender(settingsTree());
    if (kind === "header")
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    else {
      await traverse("back");
      expect(
        await screen.findByTestId("navigation-guard-pending"),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Discard changes" }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
    }
    expect(here()).toBe("/en/hr/settings?section=company&keep=1#logo");
    expect(screen.getByRole("button", { name: "Remove logo" })).toBeDisabled();
    expect(save.mock.calls[0]![0]).toMatchObject({
      remove: true,
      expectedRevision: logo.revision,
    });
    await act(async () =>
      pending.resolve(refused("LOGO_STALE", "expectedRevision")),
    );
    expect(
      await screen.findByText(/Another administrator changed the logo/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove logo" })).toBeEnabled();
    await traverse("back");
    await waitFor(() => expect(here()).toBe("/en/hr/today"));
    await traverse("forward");
    await waitFor(() =>
      expect(here()).toBe("/en/hr/settings?section=company&keep=1#logo"),
    );
  },
);

it("a logo file read completing after unmount or tenant change cannot submit or transfer a selected draft", async () => {
  const save = mutation(hrRefs.saveCompanyLogo);
  state.queries.set(getFunctionName(hrRefs.companyLogo), query(null));
  const view = openSettings("/en/hr/settings?section=company#logo");
  const bytes = deferred();
  const file = new File(["png"], "old-tenant.png", { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", { value: () => bytes.promise });
  fireEvent.change(screen.getByLabelText(field("Company logo")), {
    target: { files: [file] },
  });
  state.identityKey = "org-other:user-a";
  view.rerender(settingsTree());
  await act(async () =>
    bytes.resolve(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer,
    ),
  );
  expect(save).not.toHaveBeenCalled();
  expect(
    screen.queryByText("Selected file: old-tenant.png"),
  ).not.toBeInTheDocument();
  const second = deferred();
  // A distinct file lets a second mounted read own a distinct callback.
  const another = new File(["png"], "unmounted.png", { type: "image/png" });
  Object.defineProperty(another, "arrayBuffer", {
    value: () => second.promise,
  });
  fireEvent.change(screen.getByLabelText(field("Company logo")), {
    target: { files: [another] },
  });
  view.unmount();
  await act(async () => second.resolve(new ArrayBuffer(8)));
  expect(save).not.toHaveBeenCalled();
});

it("a stale selected logo survives nested branch Cancel; discarding the file then next Back restores the locale/query/hash origin", async () => {
  mutation(hrRefs.saveCompanyLogo).mockResolvedValue(
    refused("LOGO_STALE", "expectedRevision"),
  );
  window.history.replaceState({}, "", "/th/hr/today?keep=origin#source");
  state.queries.set(getFunctionName(hrRefs.companyLogo), query(null));
  openSettings("/th/hr/settings?section=company&keep=settings#logo");
  fireEvent.change(screen.getByLabelText(field("Company logo")), {
    target: {
      files: [new File(["png"], "retained.png", { type: "image/png" })],
    },
  });
  expect(await screen.findByText("Selected file: retained.png")).toBeVisible();
  const beforeBranch = appHistoryIndex();
  fireEvent.click(screen.getByRole("button", { name: "Add branch" }));
  const editor = await branchDialog();
  fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(appHistoryIndex()).toBe(beforeBranch));
  expect(screen.getByText("Selected file: retained.png")).toBeVisible();
  await traverse("back");
  const guard = await screen.findByRole("dialog", {
    name: "Discard changes?",
  });
  fireEvent.click(
    within(guard).getByRole("button", { name: "Discard changes" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(here()).toBe("/th/hr/settings?section=company&keep=settings#logo"),
  );
  expect(
    screen.queryByText("Selected file: retained.png"),
  ).not.toBeInTheDocument();
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/th/hr/today?keep=origin#source"));
});
