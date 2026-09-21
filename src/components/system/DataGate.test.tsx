import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

import { DataGate } from "./DataGate";

describe("DataGate", () => {
  it("keeps authorization request ids in the denied presentation", () => {
    renderWithIntl(
      <DataGate
        outcome={{
          ok: false,
          requestId: "req_denied_42",
          denial: {
            kind: "AUTHORIZATION_DENIED",
            code: "FORBIDDEN",
            requestId: "req_denied_42",
            message: "Access denied",
          },
        }}
      >
        {() => <span>ready</span>}
      </DataGate>,
      { locale: "en" },
    );

    expect(screen.getByRole("alert")).toHaveTextContent("req_denied_42");
  });

  it("does not render ready content while the query is unresolved", () => {
    renderWithIntl(
      <DataGate outcome={undefined}>{() => <span>ready</span>}</DataGate>,
      { locale: "en" },
    );

    expect(screen.queryByText("ready")).not.toBeInTheDocument();
    expect(screen.getByTestId("panel-LOADING")).toBeInTheDocument();
  });
});
