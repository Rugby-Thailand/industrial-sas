import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PrivateFileUpload } from "./PrivateFileUpload";

const labels = {
  drop: "Drop one private file here",
  browse: "Choose private file",
  limit: "Maximum 64 MB",
  remove: "Remove selected file",
  invalid: "File exceeds maximum size",
};

describe("PrivateFileUpload", () => {
  it("offers an accessible file input and reports the selected file", () => {
    const onFileChange = vi.fn();
    render(
      <PrivateFileUpload
        accept="*"
        maxSize={1024}
        resetKey={0}
        labels={labels}
        onFileChange={onFileChange}
      />,
    );
    const selected = new File(["private"], "approved.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText(labels.browse), {
      target: { files: [selected] },
    });

    expect(onFileChange).toHaveBeenLastCalledWith(selected);
    expect(screen.getByText("approved.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: labels.remove }));
    expect(onFileChange).toHaveBeenLastCalledWith(null);
  });

  it("shows a useful error and does not select an oversized file", () => {
    const onFileChange = vi.fn();
    render(
      <PrivateFileUpload
        accept="*"
        maxSize={2}
        resetKey={0}
        labels={labels}
        onFileChange={onFileChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(labels.browse), {
      target: { files: [new File(["large"], "large.pdf")] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("maximum size");
    expect(onFileChange).not.toHaveBeenCalledWith(expect.any(File));
  });
});
