export const INSTALLATION_STORAGE_KEY = "industrial-sas.installation-id.v1";

const INSTALLATION_PATTERN = /^install_[A-Za-z0-9_-]{16,56}$/;

interface InstallationStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export const isInstallationId = (value: string): boolean =>
  INSTALLATION_PATTERN.test(value);

export const mintInstallationId = (
  randomUuid: () => string = () => crypto.randomUUID(),
): string => {
  const compact = randomUuid().replaceAll("-", "");
  const value = `install_${compact}`;
  if (!isInstallationId(value)) {
    throw new Error("INSTALLATION_ID_GENERATION_FAILED");
  }
  return value;
};

export const readOrCreateInstallationId = (
  storage: InstallationStorage = window.localStorage,
  randomUuid?: () => string,
): string => {
  const stored = storage.getItem(INSTALLATION_STORAGE_KEY);
  if (stored !== null && isInstallationId(stored)) return stored;
  const created = mintInstallationId(randomUuid);
  storage.setItem(INSTALLATION_STORAGE_KEY, created);
  return created;
};
