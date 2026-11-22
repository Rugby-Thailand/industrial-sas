import {
  Bell,
  Box,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  ChartNoAxesCombined,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Contact,
  FileClock,
  FileText,
  FileUp,
  History,
  Megaphone,
  ScanLine,
  Settings2,
  ShieldCheck,
  UserRound,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import { staticDestination } from "@/lib/navigation";
import {
  QUICK_MENU_BY_KEY,
  type QuickMenuKey,
} from "../../../convex/model/home/quickMenu";

const icons: Record<QuickMenuKey, LucideIcon> = {
  "planner.finishedGoods": Box,
  "planner.jobScan": ScanLine,
  "planner.jobScanRecords": ClipboardList,
  "planner.storageLayouts": Warehouse,
  "planner.customers": Contact,
  "hr.today": Clock3,
  "hr.time": History,
  "hr.requests": FileClock,
  "hr.holidays": CalendarDays,
  "hr.leave": CalendarOff,
  "hr.leaveReview": CalendarCheck,
  "hr.announcements": Megaphone,
  "hr.announcementsManage": ClipboardCheck,
  "hr.notifications": Bell,
  "hr.payslips": FileText,
  "hr.payslipImport": FileUp,
  "hr.profile": UserRound,
  "hr.review": ShieldCheck,
  "hr.employees": Users,
  "hr.periods": CalendarClock,
  "hr.settings": Settings2,
  "admin.aiUsage": ChartNoAxesCombined,
};

export function quickMenuTile(key: QuickMenuKey) {
  return {
    ...staticDestination(key),
    Icon: icons[key],
    badge: QUICK_MENU_BY_KEY.get(key)?.badge,
  };
}
