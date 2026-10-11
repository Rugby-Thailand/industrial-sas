import { describe, expect, it } from "vitest";

import { HR_PERMISSION } from "../../../convex/model/authorization/navigationPermissions";
import { PAGE_KEYS } from "../../../convex/model/search/intent";
import {
  DESKTOP_NAVIGATION,
  FOCUS_TARGET_IDS,
  STATIC_DESTINATIONS,
  destinationHref,
  destinationTrail,
  readEmployeesUrl,
  readPeriodUrl,
  readReviewUrl,
  readSettingsSection,
  staticDestination,
  visibleDesktopNavigation,
} from "../navigation";
import { matchDestinations } from "./matchDestinations";
import { recordQuery } from "./recordQuery";

const params = (query: string) => new URLSearchParams(query);
const label = (destination: { labelKey: string }) => destination.labelKey;

describe("destination registry", () => {
  it("is the single source of the sidebar menu", () => {
    const menu = DESKTOP_NAVIGATION.flatMap((section) =>
      section.items.map((item) => item.href),
    );
    expect(menu).toEqual(
      STATIC_DESTINATIONS.filter((entry) => entry.menu).map(
        (entry) => entry.href,
      ),
    );
    expect(
      visibleDesktopNavigation([HR_PERMISSION.selfAccess])
        .flatMap((section) => section.items)
        .map((item) => item.labelKey),
    ).toEqual(["hrToday", "hrTime", "hrProfile"]);
  });

  it("covers every page key the AI may name, with unique keys and locale-free paths", () => {
    const keys = STATIC_DESTINATIONS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of PAGE_KEYS) expect(keys).toContain(key);
    for (const entry of STATIC_DESTINATIONS) {
      expect(entry.href).toMatch(/^\/(?!th\/|en\/)[a-z]/);
      expect(entry.aliases.length).toBeGreaterThan(0);
      expect(entry.permissionCodes.length).toBeGreaterThan(0);
    }
  });

  it("builds breadcrumbs from module to destination", () => {
    expect(destinationTrail("hr.settings.holidays")).toEqual([
      "sectionHr",
      "hrSettings",
      "settingsHolidays",
    ]);
    expect(destinationTrail("planner.newBuilding")).toEqual([
      "sectionPlanner",
      "storageLayouts",
      "newBuilding",
    ]);
    expect(staticDestination("hr.review").href).toBe("/hr/review");
  });

  it("builds typed record URLs only from valid parameters", () => {
    expect(
      destinationHref({
        key: "hr.selfDay",
        date: "2026-10-08",
        focus: "correction",
      }),
    ).toBe("/hr/time/2026-10-08?focus=correction");
    expect(
      destinationHref({
        key: "hr.reviewDay",
        employeeId: "k17abc",
        date: "2026-10-08",
        focus: "decision",
      }),
    ).toBe("/hr/review?employee=k17abc&date=2026-10-08&focus=decision");
    expect(
      destinationHref({
        key: "hr.employeeEdit",
        employeeId: "k1",
        focus: "schedule",
      }),
    ).toBe("/hr/employees?employee=k1&mode=edit&focus=schedule");
    expect(
      destinationHref({
        key: "hr.period",
        periodId: "p1",
        version: 4,
        focus: "export",
      }),
    ).toBe("/hr/periods/p1?version=4&focus=export");
    for (const target of [
      { key: "hr.selfDay", date: "2026-02-30" },
      {
        key: "hr.reviewDay",
        employeeId: "javascript:alert(1)",
        date: "2026-10-08",
      },
      { key: "hr.reviewDay", employeeId: "../../etc", date: "2026-10-08" },
      { key: "hr.employeeEdit", employeeId: "" },
      { key: "hr.period", periodId: "p1", version: 0 },
      { key: "hr.period", periodId: "p1", version: 1.5 },
    ] as const)
      expect(destinationHref(target)).toBeNull();
  });

  it("reads deep-link state and reports malformed links", () => {
    expect(
      readReviewUrl(
        params("employee=k1&date=2026-10-08&focus=decision&tab=certified"),
      ),
    ).toEqual({
      selection: { employeeId: "k1", date: "2026-10-08" },
      tab: "CERTIFIED",
      focus: "decision",
      invalid: false,
    });
    expect(readReviewUrl(params("employee=k1&date=nope"))).toMatchObject({
      invalid: true,
    });
    expect(readReviewUrl(params("focus=decision"))).toEqual({ invalid: false });
    expect(
      readEmployeesUrl(params("employee=k1&mode=edit&focus=schedule")),
    ).toEqual({
      mode: "EDIT",
      employeeId: "k1",
      focus: "schedule",
    });
    expect(readEmployeesUrl(params("mode=new"))).toEqual({ mode: "NEW" });
    expect(readEmployeesUrl(params("employee=<x>&mode=edit"))).toEqual({
      mode: "LIST",
      invalid: true,
    });
    expect(readPeriodUrl(params("version=3&focus=export"))).toEqual({
      version: 3,
      focus: "export",
      invalidVersion: false,
    });
    expect(readPeriodUrl(params("version=abc")).invalidVersion).toBe(true);
    expect(readPeriodUrl(params("version=0")).invalidVersion).toBe(true);
    expect(readSettingsSection(params("section=holidays"))).toBe("holidays");
    expect(readSettingsSection(params("section=__proto__"))).toBeNull();
  });

  it("keeps focus target IDs unique", () => {
    const ids = Object.values(FOCUS_TARGET_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("menu matching", () => {
  const all = [
    ...Object.values(HR_PERMISSION),
    "masterData.storageLayout.read",
    "masterData.storageLayout.manage",
  ];
  const keys = (query: string, granted: readonly string[] = all) =>
    matchDestinations(query, granted, label).map(
      (match) => match.destination.key,
    );

  it("matches Thai and English aliases, sections and tasks", () => {
    expect(keys("วันหยุด")[0]).toBe("hr.settings.holidays");
    expect(keys("holiday")[0]).toBe("hr.settings.holidays");
    expect(keys("ลืมลงเวลาเมื่อวาน")).toContain("hr.task.correction");
    expect(keys("CSV")).toContain("hr.task.exportPeriod");
    expect(keys("เข้างาน")).toContain("hr.task.clock");
    expect(keys("สแกนใบงาน")[0]).toBe("planner.jobScan");
  });

  it("hides destinations without permission", () => {
    expect(keys("วันหยุด", [HR_PERMISSION.selfAccess])).toEqual([]);
    expect(keys("สแกนใบงาน", [HR_PERMISSION.selfAccess])).toEqual([]);
    expect(keys("เพิ่มอาคาร", ["masterData.storageLayout.read"])).toEqual([
      "planner.storageLayouts",
    ]);
  });

  it("tolerates one Latin typo but never fuzzes Thai", () => {
    expect(keys("holidyas")).toEqual([]);
    expect(keys("holidys")).toContain("hr.settings.holidays");
    expect(keys("วันหยุต")).toEqual([]);
  });

  it("returns nothing for an empty query", () => {
    expect(keys("   ")).toEqual([]);
  });
});

describe("record query text", () => {
  const NONE = { kind: "NONE" } as const;

  it("strips task words and the date, keeping the name", () => {
    expect(recordQuery("ตรวจคำขอ สมชาย เมื่อวาน", "2026-10-09")).toEqual({
      text: "สมชาย",
      codes: [],
      day: { date: "2026-10-08", inferredYear: false },
      range: null,
      version: NONE,
    });
    expect(recordQuery("แก้ตารางงานสมชาย", null).text).toBe("สมชาย");
    expect(recordQuery("คุณสมชาย หน่อย", null).text).toBe("สมชาย");
    expect(
      recordQuery("ลืมลงเวลาของฉันเมื่อวาน", "2026-10-09").text,
    ).toBeNull();
  });

  it("keeps a plain name whole even when it contains a filler or task word", () => {
    // "คุณ" is a filler and "กะ" / "ตรวจ" task words: inside, at the end of,
    // or glued to a name they are part of it.
    expect(recordQuery("กิตติคุณ", null).text).toBe("กิตติคุณ");
    expect(recordQuery("คุณากร", null).text).toBe("คุณากร");
    expect(recordQuery("ตรวจคำขอ คุณากร", null).text).toBe("คุณากร");
    expect(recordQuery("แก้ตารางงานกิตติคุณ", null).text).toBe("กิตติคุณ");
    expect(recordQuery("สมศักดิ์ ชั้นดี", null).text).toBe("สมศักดิ์ ชั้นดี");
    // Thai vowels and tone marks are kept.
    expect(recordQuery("น้ำผึ้ง", null).text).toBe("น้ำผึ้ง");
  });

  it("looks codes up exactly and keeps Latin names whole", () => {
    expect(recordQuery("แก้ตารางงาน EMP-DEMO-003", null)).toMatchObject({
      text: null,
      codes: ["EMP-DEMO-003"],
    });
    expect(recordQuery("review Jonathan", null)).toMatchObject({
      text: "jonathan",
      codes: [],
    });
    expect(recordQuery("edit schedule Anan", null).text).toBe("anan");
    // Alphabetic, short numeric and one-character codes are codes too.
    expect(recordQuery("NIGHT", null).codes).toEqual(["NIGHT"]);
    expect(recordQuery("12", null).codes).toEqual(["12"]);
    expect(recordQuery("a", null)).toMatchObject({ text: null, codes: ["A"] });
    // English task and date words are not codes.
    expect(
      recordQuery("review EMP-1 attendance yesterday", "2026-10-09").codes,
    ).toEqual(["EMP-1"]);
    // A date is not a code: one employee, one day.
    expect(recordQuery("EMP-EVAL-001 2026-10-08", null)).toMatchObject({
      codes: ["EMP-EVAL-001"],
      day: { date: "2026-10-08" },
    });
  });

  it("names no record for pure page queries and reads an explicit version", () => {
    expect(recordQuery("ตั้งวันหยุด", null).text).toBeNull();
    expect(recordQuery("ส่งออกงวด 19–25 ก.ย. 2569", "2026-10-09")).toEqual({
      text: null,
      codes: [],
      day: null,
      range: { from: "2026-09-19", to: "2026-09-25", inferredYear: false },
      version: NONE,
    });
    expect(
      recordQuery("ส่งออกงวด 19–25 ก.ย. 2569 ฉบับ 1", "2026-10-09"),
    ).toMatchObject({ text: null, version: { kind: "ONE", version: 1 } });
    expect(
      recordQuery("export 2026-09-19 to 2026-09-25 v2", "2026-10-09"),
    ).toMatchObject({
      text: null,
      range: { from: "2026-09-19", to: "2026-09-25" },
      version: { kind: "ONE", version: 2 },
    });
    expect(recordQuery("ส่งออกงวด ฉบับ abc", null).version).toEqual({
      kind: "INVALID",
    });
  });
});
