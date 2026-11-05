// Shared by the client sidebar, which writes the cookie, and the server
// layout, which reads it: a plain module, since a server component cannot
// read a value exported from a "use client" file.

/** The cookie the desktop sidebar writes each time it expands or collapses. */
export const SIDEBAR_COOKIE_NAME = "sidebar_state";
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/** Expanded unless the member last collapsed it to the icon rail. */
export function sidebarOpenFromCookie(value: string | undefined): boolean {
  return value !== "false";
}
