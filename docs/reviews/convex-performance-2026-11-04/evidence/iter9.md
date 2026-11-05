Profile `iter9` · 2026-11-05T09:20:46.491Z · 3 uncached samples per target (p50) · dataset {"pallets":1305,"products":126,"zones":421,"buildings":127,"jobScans":2182,"employees":153}
Targets: candidate@e8883ecc (convex sha256:a23837ec418f4a20), base@80dc0a93 (convex sha256:a486b726209f5b84) · load avg before/after 21.7/21.4

| Screen | Function | Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note |
|---|---|---:|---:|---:|---:|---:|---:|---|
| storage | `storageLayouts/catalogue:getStorageBuilding` | 1844 | 1328.2 | 178.22 | 172.23 | 1 | 453.4 | legacy (no live subscriber) |
| fg-pallet | `finishedGoods/workflow:list` | 1440 | 914.8 | 196.09 | 182.68 | 1 | 925.4 | legacy (no live subscriber) |
| storage | `storageLayouts/catalogue:getStorageLocationMap` | 936 | 671.6 | 145.28 | 98.03 | 1 | 376.2 | legacy (no live subscriber) |
| hr-admin | `hr/roster:roster` (previous month) | 594 | 331.2 | 51.32 | 0.14 | 1 | 152.0 |  |
| fg-pallet | `finishedGoods/workflow:recommendMove` (list) | 439 | 747.7 | 102.45 | 328.2 | 1 | 128.0 |  |
| fg-pallet | `finishedGoods/workflow:recommendMove` (full payload) | 439 | 747.7 | 106.14 | 317.85 | 1 | 238.5 | legacy (no live subscriber) |
| fg-pallet | `finishedGoods/workflow:recommend` (list) | 438 | 746.9 | 101.53 | 340.92 | 1 | 127.7 |  |
| fg-pallet | `finishedGoods/workflow:recommend` (full payload) | 438 | 746.9 | 102.36 | 328.43 | 1 | 238.3 | legacy (no live subscriber) |
| storage | `storageLayouts/locationCatalogue:detail` | 312 | 274.5 | 89.52 | 82.05 | 1 | 62.6 |  |
| hr-admin | `hr/roster:roster` (no page size) | 253 | 154.2 | 47.08 | 17.09 | 1 | 0.1 | LIMIT_EXCEEDED |
| hr-admin | `hr/review:queuePage` | 251 | 139.4 | 67.64 | 61.01 | 2 | 10.0 |  |
| job-scan | `finishedGoods/jobScanLocations:options` | 218 | 134.8 | 28.14 | 26.45 | 1 | 13.2 |  |
| hr-admin | `hr/setup:employeesPage` | 141 | 83.6 | 21.03 | 18.72 | 1 | 15.0 |  |
| hr-admin | `hr/periods:preview` | 111 | 76.0 | 16.55 | 18.73 | 1 | 0.8 |  |
| hr-admin | `hr/search:adminEmployees` | 111 | 75.2 | 16.88 | 15.37 | 1 | 1.5 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (products tab) | 110 | 55.2 | 24.97 | 21.09 | 1 | 74.0 |  |
| storage | `storageLayouts/locationCatalogue:options` | 109 | 69.1 | 15.11 | 12.52 | 1 | 14.5 |  |
| job-scan | `finishedGoods/jobScanLocations:searchPage` (hit) | 98 | 37.9 | 17.38 | 134.62 | 1 | 1.3 |  |
| hr-admin | `hr/roster:roster` | 84 | 47.9 | 36.14 | 17.74 | 1 | 131.1 |  |
| storage | `storageLayouts/locationCatalogue:page` | 83 | 52.8 | 21.67 | 18.64 | 1 | 25.8 |  |
| fg-pallet | `finishedGoods/workflow:getPallet` | 75 | 50.9 | 20.23 | 20.31 | 1 | 2.3 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets tab) | 65 | 39.2 | 43.67 | 34.56 | 1 | 75.3 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets search) | 65 | 39.2 | 38.73 | 44.98 | 1 | 75.3 |  |
| job-scan | `finishedGoods/jobScans:listJobScans` (search) | 61 | 26.5 | 51.95 | 698.93 | 1 | 3.8 |  |
| job-scan | `finishedGoods/jobScanLocations:buildingOptions` | 61 | 37.8 | 14.75 | 12.56 | 1 | 7.7 |  |
| job-scan | `finishedGoods/jobScans:listJobScans` | 60 | 36.9 | 36.97 | 31.45 | 1 | 21.3 |  |
| job-scan | `finishedGoods/jobScans:listJobScans` (unmapped) | 60 | 37.0 | 33.22 | 34.95 | 1 | 21.3 |  |
| job-scan | `finishedGoods/jobScanLocations:searchPage` | 39 | 16.0 | 18.16 | 134.03 | 1 | 0.2 |  |
| storage | `storageLayouts/catalogue:getStorageBuildingInventory` | 35 | 469.4 | 50.62 | 201.63 | 1 | 447.8 |  |
| fg-product | `finishedGoods/batches:pageLegacyUnits` | 30 | 17.4 | 29.46 | 19.37 | 1 | 15.8 |  |
| storage | `storageLayouts/catalogue:listStorageBuildingsPage` | 29 | 16.2 | 12.91 | 11.39 | 1 | 13.7 |  |
| hr-admin | `hr/periods:versionRowsPage` | 29 | 16.3 | 12.24 | 11.66 | 1 | 9.4 |  |
| hr-admin | `hr/setup:accessMembersPage` | 26 | 8.4 | 14.2 | 12.28 | 1 | 0.6 |  |
| storage | `storageLayouts/catalogue:getStorageBuildingLayout` | 25 | 14.3 | 14.4 | 11.81 | 1 | 7.4 |  |
| storage | `storageLayouts/writes:layoutReadiness` | 25 | 14.3 | 14.34 | 12.26 | 1 | 1.9 |  |
| storage | `storageLayouts/catalogue:buildingOccupancy` | 21 | 8.6 | 18.44 | 89.01 | 1 | 1.0 |  |
| hr-admin | `hr/setup:employee` | 19 | 6.2 | 12.77 | 11.75 | 1 | 0.6 |  |
| fg-catalogue | `finishedGoods/catalogue:summary` | 18 | 6.9 | 11.42 | 43.93 | 1 | 0.3 |  |
| ai-usage | `aiUsage/dimensions:actorOptions` | 17 | 5.3 | 11.76 | 9.42 | 1 | 0.4 |  |
| shell | `workspace/current:readCurrent` | 16 | 5.0 | 12.07 | 10.86 | 1 | 0.5 |  |
| shell | `hr/access:display` | 16 | 5.3 | 12.1 | 11.51 | 1 | 0.7 |  |
| fg-pallet | `finishedGoods/workflow:recommendationZone` (viewed zone) | 16 | 6.2 | 12.53 | – | 1 | 0.6 |  |
| fg-pallet | `finishedGoods/workflow:recommendationZone` (move: viewed zone) | 16 | 6.4 | 12.73 | – | 1 | 0.6 |  |
| fg-pallet | `finishedGoods/workflow:recommendationZone` (switched zone) | 16 | 6.2 | 12.93 | – | 1 | 0.6 |  |
| job-scan | `finishedGoods/jobScanLocations:resolve` | 15 | 6.2 | 13.17 | 10.75 | 1 | 0.6 |  |
| job-scan | `finishedGoods/scanning:resolveLocationCode` | 13 | 5.0 | 11.57 | 9.91 | 1 | 0.5 |  |
| hr-self | `hr/self:today` | 13 | 5.8 | 13.29 | 10.96 | 1 | 0.8 |  |
| fg-product | `finishedGoods/catalogue:productSummary` | 12 | 4.3 | 12.44 | 9.15 | 1 | 0.3 |  |
| hr-self | `hr/self:profile` | 12 | 4.1 | 11.38 | 9.2 | 1 | 0.6 |  |
| hr-self | `hr/self:history` | 12 | 5.6 | 12.49 | 10.28 | 1 | 1.6 |  |
| shell | `aiUsage/reports:access` | 11 | 3.4 | 10.5 | 9.46 | 1 | 0.2 |  |
| fg-product | `finishedGoods/batches:getBatch` | 11 | 3.7 | 13.93 | 9.77 | 1 | 1.0 |  |
| storage | `storageLayouts/catalogue:buildingStatusControl` | 11 | 4.4 | 11.18 | 9.16 | 1 | 0.1 |  |
| hr-admin | `hr/leave:queuePage` | 11 | 3.4 | 11.34 | 11.51 | 1 | 0.2 |  |
| fg-product | `finishedGoods/workflow:getProduct` | 10 | 3.4 | 11.4 | 9.24 | 1 | 0.7 |  |
| fg-pallet | `finishedGoods/history:palletMoveHistory` | 10 | 3.4 | 10.89 | 9.13 | 1 | 0.1 |  |
| fg-pallet | `finishedGoods/workflow:stackChoices` | 10 | 3.4 | 10.7 | 8.73 | 1 | 0.1 |  |
| job-scan | `finishedGoods/scanning:resolvePackageCode` | 10 | 3.5 | 10.9 | 8.58 | 1 | 0.1 | NOT_OK |
| hr-self | `hr/self:requests` | 10 | 4.3 | 10.95 | 8.94 | 1 | 0.6 |  |
| hr-admin | `hr/periods:listPage` | 10 | 3.4 | 10.93 | 9.26 | 1 | 0.5 |  |
| fg-product | `finishedGoods/batches:pageProductBatches` | 9 | 2.9 | 16.05 | 11.08 | 1 | 0.1 |  |
| job-scan | `finishedGoods/jobScanLocations:page` | 9 | 2.9 | 11.69 | 10.01 | 1 | 0.2 |  |
| hr-self | `hr/announcements:self` | 9 | 3.4 | 11.46 | 9.33 | 1 | 0.1 |  |
| hr-self | `hr/notifications:list` | 9 | 3.4 | 10.49 | 8.75 | 1 | 0.2 |  |
| hr-self | `hr/leave:self` | 9 | 3.4 | 11.95 | 9.63 | 1 | 0.3 |  |
| hr-admin | `hr/roster:shifts` | 9 | 2.8 | 10.36 | 10.21 | 1 | 0.2 |  |
| hr-admin | `hr/payslips:list` | 9 | 3.4 | 10.87 | 10.16 | 1 | 0.1 | POLICY_NOT_ACTIVE |
| hr-admin | `hr/payslips:imports` | 8 | 2.7 | 10.87 | 9.88 | 1 | 0.1 | POLICY_NOT_ACTIVE |
| hr-admin | `hr/org:listDepartments` | 8 | 2.7 | 10.37 | 9.9 | 1 | 0.1 |  |
| ai-usage | `aiUsage/reports:summary` | 8 | 2.7 | 11.48 | 9.29 | 1 | 1.2 |  |
| ai-usage | `aiUsage/reports:recent` | 8 | 2.7 | 11.03 | 9.06 | 1 | 0.1 |  |

**candidate: write flows**

| Flow | Function | Docs read | Docs written | Index rows | Exec p50 ms |
|---|---|---:|---:|---:|---:|

**candidate: reactive fan-out** (0 subscriptions open on one session)

| Write | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions |
|---|---|---:|---:|---:|---:|---:|---|

**base: write flows**

| Flow | Function | Docs read | Docs written | Index rows | Exec p50 ms |
|---|---|---:|---:|---:|---:|

**base: reactive fan-out** (0 subscriptions open on one session)

| Write | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions |
|---|---|---:|---:|---:|---:|---:|---|
