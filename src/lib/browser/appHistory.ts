export const APP_HISTORY_KEY = "appNavigationIndex";

/** Only entries visited in this app count; history.length includes other sites. */
export function appHistoryIndex(): number | undefined {
  const value: unknown = window.history.state?.[APP_HISTORY_KEY];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
