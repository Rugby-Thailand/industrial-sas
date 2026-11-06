# S01 implementation brief — Phase 1 (company, branches, org masters, employment fields)

Source of truth for scope: `spec.md` in this folder, plus the acceptance tests
`tests/integration/hr-parity/01-org-positions.test.ts` (integration) and
`tests/e2e/hr-local/foundation.spec.ts` and `protocols.spec.ts` (e2e). This brief records the
design decisions taken on top of the spec. Where they conflict, this brief wins.

## In scope

S01-01..04, S01-06..19, S01-21..23 (22 tasks).

## Deferred (do not build)

- S01-05 company selector / affiliated companies: depends on unknown S01-24
  (multi-company model never observed). No runnable acceptance case claims
  coverage of this deferred feature.
- S01-20 is DUP → S06-13. S01-24, S01-25 are unknown.
- Thai province/district/sub-district master data: plain text fields for now.

## Decisions

1. **Branch ≠ warehouse.** HRZoft has both `สาขา` (legal tax branch) and
   `สถานที่ทำงาน` (workplace). We add a new `hrBranches` table for the legal
   branch. The existing `hrEmployees.warehouseId` stays as the **workplace** and
   is not changed. `warehouses` get no new fields.
2. **New tables live in `convex/model/hr/orgSchema.ts`** exporting
   `hrOrgTables`, spread into `convex/schema.ts` like `hrPolicyTables`. All use
   `tenantFields` / `byOrg`. Minimal edits to `convex/schema.ts`.
3. **Masters:** `hrDepartments` (name, nameEn?, managerEmployeeId?, status),
   `hrPositions` (name, nameEn?, status), `hrPositionLevels` (name, sortOrder,
   status). Status is `ACTIVE`/`INACTIVE`, matching `hrEmployees`. Names are
   unique per org (case-insensitive, trimmed).
4. **Company profile:** one `hrCompanyProfiles` row per org: name, nameEn?,
   taxId, address, addressEn?, province, district, subDistrict, postcode,
   phone?, fax?, hasLogo, bankAccounts
   `[{ bankName, accountNo, accountName? }]` (0..n), version + audit fields.
   Logo bytes live separately in `hrCompanyLogos` (one row per org, MIME type,
   base64, version + audit); PNG/JPEG/WebP only, at most 256 KiB decoded, with
   matching magic bytes. Profile reads expose presence without loading bytes.
5. **Branch:** name, nameEn?, revenueBranchNo, ssoEmployerAccount, type
   (`HEAD_OFFICE` | `BRANCH`), address block (same shape as company), status,
   version + audit fields. `revenueBranchNo` unique per org.
6. **Employee additions** (all optional, so existing rows stay valid):
   `branchId`, `departmentId`, `positionId`, `levelId`, `employmentType`
   (`PERMANENT` | `FIXED_TERM`), `probationEndDate` (ISO date; "on probation"
   means this is set).
7. **Concurrency and audit:** follow the existing `convex/hr/setup.ts` save
   pattern (version check, createdBy/updatedBy, `mutationWithOrg` /
   `queryWithOrg`, HR admin capability from `convex/hr/access.ts`).

## Rules (each maps to an integration test)

- **S01-06** `taxId` must be exactly 13 ASCII digits. No check digit.
- **S01-11** `revenueBranchNo` must be exactly 5 digits (`00000` = head
  office), and `type` must be `HEAD_OFFICE` iff that number is `00000`.
  `ssoEmployerAccount` is required (trimmed, non-empty, max 20 chars,
  digits and `-` only). Its exact length is unverified, so do not enforce one.
- **Any rejected save persists nothing.** Throw before any write.
- **S01-12** Inactive branches, departments, positions and levels are left out
  of the option lists for new assignment. An employee that already references
  one keeps it, and saving that employee unchanged still succeeds. Picking a
  _newly_ inactive reference is rejected. Deactivating a master never edits
  employees.
- **S01-19** For ACTIVE employees, `departmentId` is required when the org
  has at least one active department. `positionId` is required when the org has at least one active
  position. INACTIVE employees may omit both. All referenced ids must belong
  to the same org. Level, supervisor and branch are optional.
- **S01-21** Already enforced in `saveEmployee`. Keep it and cover it with a
  test.
- **S01-22** `managementView(employeeId)` returns:
  - responsible departments: departments whose `managerEmployeeId` is the
    employee;
  - subordinates: employees whose `supervisorUserId` is that employee's linked
    `userId`.
    Each entry is listed once.
- **S01-23** `suggestEmployeeCode` returns the next code. The prefix is the
  2-digit CE year, `CE year % 100`, from the Asia/Bangkok date (2026 → `26`).
  The suffix is the next 5-digit sequence among existing codes matching
  `^YY\d{5}$`. Example: last `2400010` → `2400011`. A new year restarts at
  `YY00001`. Codes that don't match the pattern are ignored. The code stays
  editable and the existing uniqueness rule is unchanged. The scan stops after
  ten batches (1,000 rows); if no matching code is found it falls back to
  `YY00001`, still subject to the save-time uniqueness check.
- **S01-07** The payslip document (`convex/hr/payslips.ts`) carries an
  `employer` block taken from the company profile: name, taxId, full address
  (address, addressEn when present, subDistrict, district, province, postcode),
  primary (first) bank account. The block is `null` when there is no profile.
  It must never be blank or hard-coded strings.

## UI (second step, after backend)

- Settings hub `?section=` panels: Company, Branches, Departments & positions
  (levels in the same panel). Editors use the shared Back-aware Dialog/Sheet.
  Every new section, editor state and action is declared in
  `docs/contracts/back-navigation.json`.
- Employee form: an "Employment" group with Department, Position, Level,
  Supervisor (existing), Branch, Workplace (existing site select, relabelled),
  Employment status (existing status), Employment type radios, On probation +
  end date. Employee list: Department and Position columns, and a department
  filter.
- Settings already uses panels with `?section=`, not tabs. Adapt the e2e
  locators from `tab` to the section heading/link and record the change in the
  test comment. Employee "Employment" is a fieldset group for now; the tabbed
  profile is slice 03.
- Copy is in Thai and English through the existing i18n messages. The Thai
  labels follow HRZoft (`spec.md` § UX notes).
