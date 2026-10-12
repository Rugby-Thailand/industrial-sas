interface RequestIdentityPersistence {
  /** Domain adapters return only an ID that passes their own validator. */
  readonly read: () => string | null;
  readonly write?: (id: string) => void;
}

/** Instance-local retry identities; never a cross-account cache or command store. */
export function createRequestIdentityRegistry() {
  const remembered = new Map<string, string>();
  return {
    request(key: string, persistence?: RequestIdentityPersistence): string {
      const existing = remembered.get(key);
      if (existing !== undefined) return existing;
      const saved = persistence?.read() ?? null;
      const id = saved ?? crypto.randomUUID();
      remembered.set(key, id);
      if (saved === null) persistence?.write?.(id);
      return id;
    },
    forget(key: string) {
      remembered.delete(key);
    },
    clear() {
      remembered.clear();
    },
  };
}
