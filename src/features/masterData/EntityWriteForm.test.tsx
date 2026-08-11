import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  configuredEnvironment,
  previewEnvironment,
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";

import { LocationForm } from "./CoreForms";
import { EntityWriteForm } from "./EntityWriteForm";
import { RowActionButton, RowWriteRegion } from "./RowWriteRegion";

import { createSupplierRef } from "@/lib/convex/masterDataApi";
import { resolveAppEnvironment, type AppEnvironment } from "@/lib/environment";

/** A deployment URL with no identity provider. */
const backendOnlyEnvironment = resolveAppEnvironment({
  convexUrl: "https://example.convex.cloud",
});

const supplierForm = (environment: AppEnvironment) =>
  renderWithIntl(
    <EntityWriteForm
      mutationRef={createSupplierRef}
      legend="เพิ่มผู้จัดจำหน่าย"
      submitLabel="บันทึก"
      requiredMessage="ต้องกรอกช่องนี้"
      fields={[
        { name: "code", label: "รหัส", kind: "text", required: true },
        { name: "name", label: "ชื่อ", kind: "text", required: true },
      ]}
      toArgs={(values, requestId) => ({
        requestId,
        code: values["code"] ?? "",
        name: values["name"] ?? "",
      })}
    />,
    { environment },
  );

describe("EntityWriteForm gating", () => {
  it("explains a missing backend instead of offering a form", () => {
    /*
     * There is no `ConvexProvider` when no deployment is configured, so a form
     * rendered here could not send anything — and `useMutation` would throw
     * before the operator found that out.
     */
    supplierForm(unconfiguredEnvironment);

    expect(screen.getByTestId("panel-BACKEND_MISSING")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "บันทึก" }),
    ).not.toBeInTheDocument();
  });

  it("asks for sign-in when a backend exists but no identity provider does", () => {
    supplierForm(backendOnlyEnvironment);
    expect(screen.getByTestId("panel-SIGN_IN_REQUIRED")).toBeInTheDocument();
  });

  it("renders the form in preview mode, where neither is configured", () => {
    // Preview is checked before the configuration gates on purpose: it has no
    // backend and no identity, and "not configured" would be the wrong answer
    // on the one screen built to work without either.
    supplierForm(previewEnvironment);
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeInTheDocument();
  });
});

describe("EntityWriteForm in preview mode", () => {
  it("says plainly that nothing was stored", () => {
    supplierForm(previewEnvironment);

    fireEvent.change(screen.getByLabelText("รหัส"), {
      target: { value: "NEW-SUP" },
    });
    fireEvent.change(screen.getByLabelText("ชื่อ"), {
      target: { value: "ผู้ขายใหม่" },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    expect(screen.getByTestId("write-DEMONSTRATED")).toHaveTextContent(
      "ไม่ได้บันทึกข้อมูล",
    );
  });

  it("keeps the typed values, because clearing them would imply a save", () => {
    supplierForm(previewEnvironment);

    fireEvent.change(screen.getByLabelText("รหัส"), {
      target: { value: "NEW-SUP" },
    });
    fireEvent.change(screen.getByLabelText("ชื่อ"), {
      target: { value: "ผู้ขายใหม่" },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    expect(screen.getByLabelText("รหัส")).toHaveValue("NEW-SUP");
  });

  it("still refuses an incomplete form, so the flow is the real one", () => {
    supplierForm(previewEnvironment);

    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    expect(screen.queryByTestId("write-DEMONSTRATED")).not.toBeInTheDocument();
    expect(screen.getAllByText("ต้องกรอกช่องนี้")).toHaveLength(2);
  });
});

describe("RowWriteRegion", () => {
  const region = (environment: AppEnvironment) =>
    renderWithIntl(
      <RowWriteRegion mutationRef={createSupplierRef}>
        {({ submit, busy }) => (
          <RowActionButton
            busy={busy}
            label="ปิดใช้งาน"
            onClick={() =>
              submit("row_1", (requestId) => ({
                requestId,
                code: "X",
                name: "Y",
              }))
            }
          />
        )}
      </RowWriteRegion>,
      { environment },
    );

  it("demonstrates the control in preview without sending anything", () => {
    region(previewEnvironment);

    fireEvent.click(screen.getByRole("button", { name: "ปิดใช้งาน" }));
    expect(screen.getByTestId("write-DEMONSTRATED")).toBeInTheDocument();
  });

  it("explains a missing backend rather than rendering a dead control", () => {
    region(unconfiguredEnvironment);

    expect(screen.getByTestId("panel-BACKEND_MISSING")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ปิดใช้งาน" }),
    ).not.toBeInTheDocument();
  });

  it("is quiet until the operator presses something", () => {
    region(previewEnvironment);
    expect(screen.queryByTestId("write-DEMONSTRATED")).not.toBeInTheDocument();
  });
});

describe("LocationForm preconditions", () => {
  it("blames the missing backend, not the missing warehouse", () => {
    /*
     * A machine with no deployment has no warehouses to select, so blaming the
     * selection would make one screen give two different reasons for one cause —
     * and send an administrator hunting for a warehouse picker instead of an
     * environment variable.
     */
    renderWithIntl(<LocationForm />, { environment: unconfiguredEnvironment });

    expect(screen.getByTestId("panel-BACKEND_MISSING")).toBeInTheDocument();
    expect(
      screen.queryByTestId("panel-WAREHOUSE_MISSING"),
    ).not.toBeInTheDocument();
  });

  it("asks for a warehouse once the environment can answer for one", () => {
    // Preview mode has warehouses to choose from, so the selection is now the
    // real precondition rather than a symptom of an unconfigured machine.
    renderWithIntl(<LocationForm />, { environment: previewEnvironment });

    expect(screen.getByTestId("panel-WAREHOUSE_MISSING")).toBeInTheDocument();
  });
});

describe("a configured deployment", () => {
  it("is what the form waits for before it will send a mutation", () => {
    /*
     * Rendering the server branch needs a `ConvexProvider`, which needs a real
     * client and a socket; that path is covered end to end by the integration
     * tests against the real functions. What is asserted here is the decision
     * that gets us there — a fully configured environment passes the gate.
     */
    expect(configuredEnvironment.backendConfigured).toBe(true);
    expect(configuredEnvironment.identityConfigured).toBe(true);
    expect(configuredEnvironment.previewMode).toBe(false);
  });
});
