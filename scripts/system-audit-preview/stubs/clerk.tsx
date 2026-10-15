import type { ReactNode } from "react";
export const useAuth = () => ({
  userId: "audit-user",
  orgId: "audit-org",
  isLoaded: true,
  isSignedIn: true,
  getToken: async () => null,
});
export const useUser = () => ({ isLoaded: true, user: { id: "audit-user" } });
export const useOrganization = () => ({
  isLoaded: true,
  organization: { id: "audit-org", name: "Demo organization" },
});
export const OrganizationList = () => (
  <div className="rounded-lg border border-border p-4 text-sm text-muted">
    Demo organization selector
  </div>
);
export const UserButton = () => null;
export const ClerkProvider = ({ children }: { children: ReactNode }) =>
  children;
