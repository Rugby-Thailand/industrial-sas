import { describe, expect, it, vi } from "vitest";

import {
  INSTALLATION_STORAGE_KEY,
  isInstallationId,
  mintInstallationId,
  readOrCreateInstallationId,
} from "./installationId";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("browser installation correlation", () => {
  it("mints an opaque value in the server's accepted alphabet", () => {
    expect(mintInstallationId(() => UUID)).toBe(
      "install_123e4567e89b12d3a456426614174000",
    );
    expect(isInstallationId(mintInstallationId(() => UUID))).toBe(true);
  });

  it("reuses a valid installation rather than changing device identity", () => {
    const storage = new Map([
      [INSTALLATION_STORAGE_KEY, `install_${"a".repeat(32)}`],
    ]);
    const setItem = vi.fn((key: string, value: string) =>
      storage.set(key, value),
    );
    const value = readOrCreateInstallationId(
      { getItem: (key) => storage.get(key) ?? null, setItem },
      () => UUID,
    );
    expect(value).toBe(`install_${"a".repeat(32)}`);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("replaces malformed local state instead of sending it to the server", () => {
    const storage = new Map([
      [INSTALLATION_STORAGE_KEY, "copied secret value"],
    ]);
    const value = readOrCreateInstallationId(
      {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, next) => storage.set(key, next),
      },
      () => UUID,
    );
    expect(value).toBe("install_123e4567e89b12d3a456426614174000");
    expect(storage.get(INSTALLATION_STORAGE_KEY)).toBe(value);
  });
});
