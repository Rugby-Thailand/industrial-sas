export interface PersistenceScope {
  readonly feature: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly warehouseId: string;
}

/** Stable scope for private browser state; ordinary existing IDs retain their keys. */
export function scopeKey(scope: PersistenceScope): string {
  const parts = [
    scope.feature,
    scope.organizationId,
    scope.userId,
    scope.warehouseId,
  ];
  if (parts.some((part) => part.trim().length === 0)) {
    throw new Error(
      "Persistence scope requires a feature, organization, user and warehouse",
    );
  }
  return parts.map(encodeURIComponent).join(":");
}
