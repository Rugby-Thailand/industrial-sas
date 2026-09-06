# Finished-goods table view

Added 2026-09-06 in codex/storage-planner.

The catalogue now has icon-only Card view / Table view controls for both Products and Pallets. Existing search, status filters and empty states apply to either layout. Product rows show name/SKU, default quantity, storage format, pallet count, status and an edit/view action. Pallet rows show code/product, quantity, dimensions, lot, status and navigation to the existing measurement/detail page.

Based on the requested `pnpm dlx shadcn@latest add @reui/c-table-10` registry component. Used the CLI dry-run/view to obtain the actual pattern and its Table primitive. Adapted the primary/secondary text, status and trailing action structure; reused existing Button and Status components and theme tokens. The full installer would overwrite Button and add global CSS/dependencies, so only the table source needed for this feature was added. No package or global theme changes were made for this task.

Verification: targeted product/catalogue and accessibility suites, TypeScript and targeted ESLint. Browser checked product/pallet tables, desktop rendering and narrow-screen scroll containment (effective CSS viewport 487px, page 487px, table scroll 720px within 454px container). Browser console returned no errors. Temporary browser viewport override reset and QA tab closed.
