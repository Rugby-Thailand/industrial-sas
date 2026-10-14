# System UI audit preview

This local fixture renders the production storage, scanner, profile and access
components with synthetic data. It makes the repetition audit reproducible
without organization credentials or warehouse writes.

```sh
pnpm exec vite --config scripts/system-audit-preview/vite.config.mjs
```

Open `http://localhost:3290/?view=zone-card&locale=th`. `AUDIT_PORT` changes
the port. `AUDIT_SOURCE_ROOT` selects another checkout's production components
for a before comparison; keep the fixture files and dependency versions the same.

| Query       | Values                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view`      | `workspace`, `zone-card`, `floor-list`, `catalogue`, `named`, `profile`, `organization`, `workspace-error`, `destination`, `picker`, `job-scan`, `scan-summary`, `record` |
| `locale`    | `en` or `th`                                                                                                                                                              |
| `theme`     | `light` or `dark`                                                                                                                                                         |
| `identity`  | Omit for equal location name/code; `distinct` retains a separate name                                                                                                     |
| `inventory` | Omit for empty storage; `occupied` includes a stored demo pallet/product                                                                                                  |
| `positions` | Include to render equal and distinct position name/code examples                                                                                                          |

Useful interactions:

- Select the workspace map location to open its real inspector or mobile sheet.
- Expand **QR labels** in a location card to inspect position identities.
- Open **Filter locations**, then **Grid view** in the desktop floor list.
- Choose **All locations** in the catalogue, then its location's QR action.
- Choose the demo location in Job scan, then open **Scan code** or **Photo AI**.
- Start a destination camera or open picker acquisition to inspect failure,
  retry and closure controls. The fixture deliberately denies real camera access.

Convex subscriptions, Clerk identity, server translations and routing use local
stand-ins. Components, CSS, translations, camera boxes, dialogs and disclosure
hooks come from the selected source checkout. Backend mutation/action stubs refuse
writes and AI calls. File selection and camera controls are real component UI;
camera failure is synthetic. Local draft/history state uses only demo identities.

The fixture provides visual evidence. Registered-handler tests verify backend
behavior, caller suites verify draft/concurrency/navigation behavior, and existing
Playwright suites verify routing, browser camera fixtures and responsive storage.
Fixture links do not exercise authenticated application routing. Resizing the T3
preview changes CSS viewport width, not its desktop user agent.
