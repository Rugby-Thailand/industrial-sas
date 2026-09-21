// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drafts, preferences, sessionPreferences } from "./storage";
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
describe("validated browser storage", () => {
  const decode = (value: unknown) =>
    typeof value === "string" ? value : "default";
  it("keeps existing JSON keys and isolates session preferences", () => {
    drafts.write("org:user:warehouse:draft", "draft");
    expect(localStorage.getItem("org:user:warehouse:draft")).toBe('"draft"');
    expect(drafts.read("org:user:warehouse:draft", decode, "failed")).toBe(
      "draft",
    );
    sessionPreferences.write("org:user:warehouse:draft", "preview");
    expect(preferences.read("org:user:warehouse:draft", decode, "failed")).toBe(
      "draft",
    );
    expect(
      sessionPreferences.read("org:user:warehouse:draft", decode, "failed"),
    ).toBe("preview");
  });
  it("delegates schema migration and distinguishes absent from malformed drafts", () => {
    expect(drafts.read("draft", decode, "blocked")).toBe("default");
    localStorage.setItem("draft", "invalid JSON");
    expect(drafts.read("draft", decode, "blocked")).toBe("blocked");
    localStorage.setItem("draft", '{"version":1}');
    expect(
      drafts.read(
        "draft",
        () => {
          throw Error("invalid schema");
        },
        "blocked",
      ),
    ).toBe("blocked");
  });
  it("reports blocked writes so required draft persistence can stop a mutation", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw Error("quota");
    });
    expect(drafts.write("draft", { pending: true })).toBe(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw Error("blocked");
    });
    expect(drafts.read("draft", decode, "blocked")).toBe("blocked");
    expect(drafts.has("draft")).toBe(false);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw Error("blocked");
    });
    expect(drafts.remove("draft")).toBe(false);
  });
});
