# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Warehouse workers scan Thai factory job tickets and location labels and record storage information. Organization administrators review AI usage and cost across warehouses and users. HR users use AI Search for navigation.

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
