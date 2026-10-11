/** Clerk is not loaded in the visual fixture; the account button renders nothing. */
export const UserButton = () => null;
export const OrganizationList = () => null;
export const ClerkProvider = ({ children }: { children: unknown }) => children;
export const useAuth = () => ({
  isLoaded: true,
  isSignedIn: false,
  getToken: async () => null,
});
