import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { EntityForm, type FormFieldSpec } from "./EntityForm";
import { WriteOutcomeNotice } from "./WriteOutcomeNotice";

const FIELDS: readonly FormFieldSpec[] = [
  {
    name: "code",
    label: "รหัส",
    kind: "text",
    required: true,
    monospace: true,
    hint: "ห้ามซ้ำ",
  },
  { name: "name", label: "ชื่อ", kind: "text", required: true },
  {
    name: "kind",
    label: "ชนิด",
    kind: "select",
    options: [
      { value: "GTIN", label: "GTIN" },
      { value: "SUPPLIER", label: "ผู้จัดจำหน่าย" },
    ],
  },
];

const renderForm = (
  overrides: Partial<Parameters<typeof EntityForm>[0]> = {},
) => {
  const onSubmit = vi.fn();
  const result = renderWithIntl(
    <EntityForm
      legend="เพิ่มรายการ"
      fields={FIELDS}
      submitLabel="บันทึก"
      requiredMessage="ต้องกรอกช่องนี้"
      busy={false}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit, result };
};

describe("EntityForm", () => {
  it("labels every control, so each one has an accessible name", () => {
    renderForm();

    expect(screen.getByLabelText("รหัส")).toBeInTheDocument();
    expect(screen.getByLabelText("ชื่อ")).toBeInTheDocument();
    expect(screen.getByLabelText("ชนิด")).toBeInTheDocument();
  });

  it("groups the controls under a legend rather than a bare heading", () => {
    renderForm();
    expect(
      screen.getByRole("group", { name: "เพิ่มรายการ" }),
    ).toBeInTheDocument();
  });

  it("hands the trimmed values to its caller", () => {
    const { onSubmit } = renderForm();

    fireEvent.change(screen.getByLabelText("รหัส"), {
      target: { value: "  SIAM-STEEL  " },
    });
    fireEvent.change(screen.getByLabelText("ชื่อ"), {
      target: { value: "สยามสตีล" },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    expect(onSubmit).toHaveBeenCalledWith({
      code: "SIAM-STEEL",
      name: "สยามสตีล",
      kind: "GTIN",
    });
  });

  it("names a blank required field instead of disabling the button", () => {
    /*
     * A disabled submit with no explanation is the least actionable state on a
     * warehouse screen. Submitting an incomplete form has to produce a message
     * that says which field, next to that field.
     */
    const { onSubmit } = renderForm();

    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText("ต้องกรอกช่องนี้")).toHaveLength(2);
    expect(screen.getByLabelText("รหัส")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("marks the field the server blamed", () => {
    renderForm({ invalidField: "code" });
    expect(screen.getByLabelText("รหัส")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("ชื่อ")).not.toHaveAttribute("aria-invalid");
  });

  it("describes a field by its hint", () => {
    renderForm();
    expect(screen.getByLabelText("รหัส")).toHaveAccessibleDescription(
      "ห้ามซ้ำ",
    );
  });

  it("disables the controls while a request is in flight", () => {
    renderForm({ busy: true });
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeDisabled();
    expect(screen.getByLabelText("รหัส")).toBeDisabled();
  });

  it("ignores a second submission while one is outstanding", () => {
    const { onSubmit } = renderForm({ busy: true });
    fireEvent.submit(
      screen.getByRole("group", { name: "เพิ่มรายการ" }).closest("form")!,
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps what was typed until the caller raises the reset signal", () => {
    /*
     * The signal is raised on a *confirmed* write and nothing else. Clearing on
     * any submission would wipe an operator's typing after a refusal they were
     * about to correct — which is the moment the values matter most.
     *
     * The signal is raised from inside the tree rather than by re-rendering the
     * root, because replacing the root remounts the form and an empty field
     * would then prove nothing.
     */
    renderWithIntl(<ResetHarness />);

    fireEvent.change(screen.getByLabelText("รหัส"), {
      target: { value: "TYPED" },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(screen.getByLabelText("รหัส")).toHaveValue("TYPED");

    fireEvent.click(screen.getByRole("button", { name: "saved" }));
    expect(screen.getByLabelText("รหัส")).toHaveValue("");
  });
});

/** A form whose reset signal can be raised without remounting it. */
function ResetHarness() {
  const [resetSignal, setResetSignal] = useState(0);

  return (
    <>
      <button type="button" onClick={() => setResetSignal((n) => n + 1)}>
        saved
      </button>
      <EntityForm
        legend="เพิ่มรายการ"
        fields={FIELDS}
        submitLabel="บันทึก"
        requiredMessage="ต้องกรอกช่องนี้"
        busy={false}
        resetSignal={resetSignal}
        onSubmit={() => undefined}
      />
    </>
  );
}

describe("WriteOutcomeNotice", () => {
  it("says nothing before anything has been submitted", () => {
    const { container } = renderWithIntl(
      <WriteOutcomeNotice state={{ kind: "IDLE" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("distinguishes a first write from a replay", () => {
    /*
     * A replay is the idempotency key doing its job, not a failure and not a
     * duplicate. Saying so is what stops someone "fixing" it by submitting
     * again.
     */
    const first = renderWithIntl(
      <WriteOutcomeNotice
        state={{ kind: "SAVED", documentId: "d1", replayed: false }}
      />,
    );
    expect(first.getByText("บันทึกแล้ว")).toBeInTheDocument();
    first.unmount();

    const replay = renderWithIntl(
      <WriteOutcomeNotice
        state={{ kind: "SAVED", documentId: "d1", replayed: true }}
      />,
    );
    expect(replay.getByText("บันทึกไว้แล้วก่อนหน้านี้")).toBeInTheDocument();
  });

  it("says in the title that preview mode stored nothing", () => {
    renderWithIntl(<WriteOutcomeNotice state={{ kind: "DEMONSTRATED" }} />);
    expect(screen.getByTestId("write-DEMONSTRATED")).toHaveTextContent(
      "ไม่ได้บันทึกข้อมูล",
    );
  });

  it("quotes the request ID on a denial and explains nothing further", () => {
    // The server refuses to say which permission was missing (`INV-0002-07`).
    renderWithIntl(
      <WriteOutcomeNotice state={{ kind: "DENIED", requestId: "req_42" }} />,
    );

    const notice = screen.getByTestId("write-DENIED");
    expect(notice).toHaveTextContent("req_42");
    expect(notice).not.toHaveTextContent("NO_PERMISSION");
    expect(notice).toHaveAttribute("role", "alert");
  });

  it("shows a refusal code verbatim next to its explanation", () => {
    renderWithIntl(
      <WriteOutcomeNotice
        state={{ kind: "REFUSED", code: "DUPLICATE_KEY", field: "code" }}
      />,
    );

    // The code is the only string that connects a screenshot to a server log.
    expect(screen.getByText("DUPLICATE_KEY")).toBeInTheDocument();
    expect(screen.getByTestId("write-REFUSED")).toHaveTextContent(
      "มีรายการที่ใช้รหัสนี้อยู่แล้ว",
    );
  });

  it("falls back to the raw code for a refusal the catalogue does not know", () => {
    // The server is versioned separately from the browser. A code the client
    // has no message for is still better shown than swallowed.
    renderWithIntl(
      <WriteOutcomeNotice
        state={{ kind: "REFUSED", code: "NEW_SERVER_CODE" }}
      />,
    );
    expect(screen.getAllByText("NEW_SERVER_CODE").length).toBeGreaterThan(0);
  });

  it("tells the operator that a transport failure is safe to retry", () => {
    renderWithIntl(
      <WriteOutcomeNotice state={{ kind: "FAILED", code: "UNKNOWN" }} />,
    );
    expect(screen.getByTestId("write-FAILED")).toHaveTextContent(
      "กดบันทึกอีกครั้งได้อย่างปลอดภัย",
    );
  });
});
