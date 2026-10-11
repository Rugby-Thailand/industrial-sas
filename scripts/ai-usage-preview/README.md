# AI usage visual fixture

A loopback-only page for independent screenshot review of the AI usage
report. It renders the production `DesktopShell`, `AiUsageScreen`,
`WorkspaceProvider`, `HrAccessProvider` and `AiUsageAccessProvider`
unchanged, with the real message catalogues and `globals.css`.

Only these modules are replaced (see `vite.config.mjs`):

| Module              | Stand-in                    | Why                                                         |
| ------------------- | --------------------------- | ----------------------------------------------------------- |
| `convex/react`      | `stubs/convex-react.ts`     | Answers queries from `stubs/fixtureData.ts` in memory.      |
| `@clerk/nextjs`     | `stubs/clerk.ts`            | No identity; the account button renders nothing.            |
| `next/navigation`   | `stubs/next-navigation.ts`  | No Next.js router outside `next dev`.                       |
| `next/link`         | `stubs/next-navigation.ts`  | `useLinkStatus` only.                                       |
| `@/i18n/navigation` | `stubs/i18n-navigation.tsx` | Path is `/ai-usage`; the language selector sets `?locale=`. |

There is no Convex client, sign-in, auth bypass, upstream FX/FAQ request or
write. Mutations and actions throw. The estimate snapshot is fixed to the
values read from the documented sources on 2026-10-11 (USD/THB 33.583; card
funding 5.5%, US$0.80 minimum). The page loads Geist from Google Fonts, as
the app self-hosts it through `next/font`; no page data is sent.

## Run

```sh
pnpm preview:ai-usage   # http://127.0.0.1:3191
```

## URL parameters

| Parameter   | Values                                            | Default |
| ----------- | ------------------------------------------------- | ------- |
| `locale`    | `en`, `th`                                        | `en`    |
| `theme`     | `dark`, `light`                                   | `dark`  |
| `data`      | `empty` (matches the references), `usage`         | `empty` |
| `estimate`  | `ready`, `stale`, `unavailable`, `loading`        | `ready` |
| `workspace` | `ready`, `none` (no storage access)               | `ready` |
| `label`     | `0` hides the "Visual fixture · sample data" pill | shown   |

Review widths: 1440 px desktop, 539 px medium, 390 px phone. The desktop
sidebar starts collapsed (as in the app); expand it to see the warehouse.

Screenshots from this page are fixture evidence, not authenticated runtime
evidence. Sample names and amounts in `stubs/fixtureData.ts` are synthetic.
