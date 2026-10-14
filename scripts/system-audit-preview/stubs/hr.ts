import { HR_CODES } from "@/lib/navigation";
export const useHrAccess = () => ({
  status: "READY",
  permissions: Object.values(HR_CODES),
  timezone: "Asia/Bangkok",
  timezoneSupported: true,
  today: "2026-10-14",
  sites: [],
  sitesComplete: true,
  identityKey: "audit-org:audit-user",
});
export const useHrCan = () => true;
