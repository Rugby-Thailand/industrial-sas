// Credential-free identity boundary for the real Home and desktop shell.
export function useAuth() {
  return {
    isLoaded: true,
    isSignedIn: true,
    orgId: "fixture-clerk-org",
    userId: "fixture-clerk-user",
    getToken: async () => null,
  };
}

export function UserButton() {
  return null;
}

export function useUser() {
  return { isLoaded: true, user: { fullName: "Fixture member" } };
}
