# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Members of a customer organization see only the modules, warehouses, and records their roles grant. The default roles are organization administrator, warehouse manager, supervisor, HR employee, HR supervisor, and HR administrator; one member can hold several.

Warehouse managers work in their assigned warehouses. They scan Thai factory job tickets and location labels from phone photos; record finished goods, batches, packing, and pallet measurement, placement, stacking, and moves; and maintain building, floor, and storage-location plans. Supervisors view the same plans and records without changing them.

Employees use the People module for their own attendance. They clock in and out, check their attendance history, request time corrections and leave, and read company holidays, announcements, notifications, and payslips. HR supervisors also review attendance and leave for their assigned direct reports. HR administrators maintain employees, shifts, rosters, holidays, HR settings and access, announcements, and payslip imports, and they close and export attendance periods. Members with HR access can use AI Search to find HR pages and tasks.

Organization administrators hold every warehouse and HR permission and review AI usage and cost across warehouses and users.

## Product Purpose

โยงกิจ (Yongkit, pronounced “โยง-กิด”) is industrial management software that brings warehouse operations and HR into one workspace. The authenticated application records storage, finished-goods, job-ticket, attendance, and leave workflows. AI usage reporting makes the actual provider spend visible without adding work to ticket scanning.

## Capabilities and Constraints

### Product naming

The approved product name is **โยงกิจ** in Thai and **Yongkit** in English, pronounced **โยง-กิด**. Use the same name for the short app label. The Thai descriptor is **ระบบบริหารจัดการอุตสาหกรรม**; the English descriptor is **Industrial management software**. Page-title copy uses `{page} · {brand}` in the page's language. Keep customer organization names separate from the product brand.

Use one product brand with descriptive module names: **คลังสินค้า / Warehouse**, **บุคลากร / People**, and **ผู้ดูแลองค์กร / Administration**. Production, purchasing, sales, and accounting are future expansion areas, not claims of currently available modules. Do not describe the current product as a complete ERP suite.

### Implementation constraints

Use Next.js, Convex, Clerk, Thai and English, and the incumbent application components. Usage belongs to the organization and authorized actor. Track provider calls independently of ticket saving. Report job-ticket scans, location-label scans, and AI Search separately. Distinguish unknown costs from zero. Report actual USD and estimated THB separately. The user chose this month as the default reporting period.

## Operating Context

Scan job tickets and location labels from phone photos and review reports on desktop or mobile. Reports are accessible to authorized organization administrators.

## Evidence on Hand

The accepted feature plan is docs/plans/ai-usage-tracking-2026-10-10.md. Existing source and components are the visual authority.
