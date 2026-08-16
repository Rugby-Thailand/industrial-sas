/**
 * Clerk uses path routing for verification and SSO callbacks below `/sign-in`.
 * Owning this catch-all keeps those steps out of the application's 404 route.
 */
export { default } from "../SignInScreen";
