/** Persistence mechanics only. Callers own schema validation, scope and migrations. */
export function browserStorage(kind: "local" | "session" = "local") {
  const storage = () =>
    kind === "local" ? window.localStorage : window.sessionStorage;
  return {
    read<T>(key: string, decode: (value: unknown) => T, fallback: T): T {
      try {
        const raw = storage().getItem(key);
        return decode(raw === null ? null : JSON.parse(raw));
      } catch {
        return fallback;
      }
    },
    has(key: string): boolean {
      try {
        return storage().getItem(key) !== null;
      } catch {
        return false;
      }
    },
    write(key: string, value: unknown): boolean {
      try {
        storage().setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key: string): boolean {
      try {
        storage().removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}
export const preferences = browserStorage();
// Separate intent from preferences; draft callers must honor failed required writes.
export const drafts = browserStorage();
export const sessionPreferences = browserStorage("session");
