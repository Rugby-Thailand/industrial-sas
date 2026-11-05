Profile `iter8-xl` · 2026-11-05T08:16:18.618Z · 7 uncached samples per target (p50) · dataset {"pallets":1305,"products":126,"zones":421,"buildings":127,"jobScans":8000,"employees":765}
Targets: candidate@f9903ff9 (convex sha256:ec7564df058c0f30), base@80dc0a93 (convex sha256:a486b726209f5b84) · load avg before/after 22.9/32.3

| Screen | Function | Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note |
|---|---|---:|---:|---:|---:|---:|---:|---|
| storage | `storageLayouts/catalogue:getStorageBuilding` | 1844 | 1328.2 | 228.81 | 225.01 | 1 | 453.4 | legacy (no live subscriber) |
| fg-pallet | `finishedGoods/workflow:list` | 1440 | 914.8 | 213.41 | 206.58 | 1 | 925.4 | legacy (no live subscriber) |
| storage | `storageLayouts/catalogue:getStorageLocationMap` | 936 | 671.6 | 130.5 | 124.82 | 1 | 376.2 | legacy (no live subscriber) |
| hr-admin | `hr/roster:roster` (previous month) | 594 | 331.2 | 75.56 | 0.22 | 1 | 152.0 |  |
| fg-pallet | `finishedGoods/workflow:recommendMove` (list) | 439 (was 688) | 747.7 | 113.09 | 0.17 | 1 | 128.0 |  |
| fg-pallet | `finishedGoods/workflow:recommendMove` (full payload) | 439 (was 688) | 747.7 | 132.54 | 395.31 | 1 | 238.5 | legacy (no live subscriber) |
| fg-pallet | `finishedGoods/workflow:recommend` (list) | 438 (was 687) | 746.9 | 188.95 | 0.18 | 1 | 127.7 |  |
| fg-pallet | `finishedGoods/workflow:recommend` (full payload) | 438 (was 687) | 746.9 | 166.9 | 540.74 | 1 | 238.3 | legacy (no live subscriber) |
| storage | `storageLayouts/locationCatalogue:detail` | 312 | 274.5 | 102.11 | 90.01 | 1 | 62.6 |  |
| hr-admin | `hr/roster:roster` (no page size) | 253 | 154.0 | 80.23 | 63.03 | 1 | 0.1 | LIMIT_EXCEEDED |
| hr-admin | `hr/review:queuePage` | 251 | 139.2 | 103.27 | 102.53 | 2 | 10.1 |  |
| job-scan | `finishedGoods/jobScanLocations:options` | 218 | 134.8 | 46.13 | 37.32 | 1 | 13.2 |  |
| hr-admin | `hr/setup:employeesPage` | 141 | 83.3 | 30.7 | 32.58 | 1 | 14.9 |  |
| hr-admin | `hr/periods:preview` | 111 (was 776) | 75.7 | 24.71 | 65.5 | 1 | 0.8 |  |
| hr-admin | `hr/search:adminEmployees` | 111 | 74.9 | 43.62 | 43.26 | 1 | 1.5 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (products tab) | 110 | 55.2 | 54.87 | 62.26 | 1 | 74.0 |  |
| storage | `storageLayouts/locationCatalogue:options` | 109 | 69.1 | 24.15 | 21.83 | 1 | 14.5 |  |
| job-scan | `finishedGoods/jobScanLocations:searchPage` (hit) | 98 | 37.9 | 32.08 | 307.89 | 1 | 1.3 |  |
| hr-admin | `hr/roster:roster` | 84 | 47.8 | 54.93 | 0.15 | 1 | 131.1 |  |
| storage | `storageLayouts/locationCatalogue:page` | 83 | 52.8 | 24.14 | 22.85 | 1 | 25.8 |  |
| fg-pallet | `finishedGoods/workflow:getPallet` | 75 | 50.9 | 57.25 | 71.78 | 1 | 2.3 |  |
| job-scan | `finishedGoods/jobScans:listJobScans` (search) | 70 | 30.2 | 1292.73 | 13896.97 | 1 | 3.8 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets tab) | 65 | 39.2 | 116.22 | 128.52 | 1 | 75.3 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets search) | 65 | 39.2 | 147.13 | 131.52 | 1 | 75.3 |  |
| job-scan | `finishedGoods/jobScanLocations:buildingOptions` | 61 | 37.8 | 26.7 | 18.44 | 1 | 7.7 |  |
| job-scan | `finishedGoods/jobScans:listJobScans` | 60 | 37.1 | 468.03 | 514.12 | 1 | 21.2 |  |
| job-scan | `finishedGoods/jobScans:listJobScans` (unmapped) | 60 | 36.9 | 639.35 | 489.76 | 1 | 21.3 |  |
| job-scan | `finishedGoods/jobScanLocations:searchPage` | 39 | 16.0 | 23.54 | 177.7 | 1 | 0.2 |  |
| storage | `storageLayouts/catalogue:getStorageBuildingInventory` | 35 | 469.4 | 66.61 | 270.04 | 1 | 447.8 |  |
| fg-product | `finishedGoods/batches:pageLegacyUnits` | 30 | 17.4 | 76.48 | 99.95 | 1 | 15.8 |  |
| storage | `storageLayouts/catalogue:listStorageBuildingsPage` | 29 | 16.2 | 16.3 | 16.27 | 1 | 13.7 |  |
| hr-admin | `hr/periods:versionRowsPage` | 29 | 16.3 | 16.26 | 13.75 | 1 | 9.4 |  |
| hr-admin | `hr/setup:accessMembersPage` | 26 | 8.4 | 20.06 | 16.38 | 1 | 0.6 |  |
| storage | `storageLayouts/catalogue:getStorageBuildingLayout` | 25 | 14.3 | 15.71 | 15.19 | 1 | 7.4 |  |
| storage | `storageLayouts/writes:layoutReadiness` | 25 | 14.3 | 15.8 | 14.95 | 1 | 1.9 |  |
| storage | `storageLayouts/catalogue:buildingOccupancy` | 21 | 8.6 | 13.47 | 112.2 | 1 | 1.0 |  |
| hr-admin | `hr/setup:employee` | 19 | 6.2 | 27.28 | 31.05 | 1 | 0.6 |  |
| fg-catalogue | `finishedGoods/catalogue:summary` | 18 | 6.9 | 75.84 | 265 | 1 | 0.3 |  |
| ai-usage | `aiUsage/dimensions:actorOptions` | 17 | 5.3 | 25.68 | 24.42 | 1 | 0.4 |  |
| shell | `workspace/current:readCurrent` | 16 | 5.0 | 29.98 | 29.09 | 1 | 0.5 |  |
| shell | `hr/access:display` | 16 | 5.3 | 99.08 | 68.17 | 1 | 0.7 |  |
| fg-pallet | `finishedGoods/workflow:recommendationZone` (viewed zone) | 16 (was 17) | 6.2 | 15.1 | 0.1 | 1 | 0.6 |  |
| fg-pallet | `finishedGoods/workflow:recommendationZone` (move: viewed zone) | 16 (was 17) | 6.4 | 15.44 | 0.11 | 1 | 0.6 |  |
| fg-pallet | `finishedGoods/workflow:recommendationZone` (switched zone) | 16 | 6.2 | 14.12 | 0.11 | 1 | 0.6 |  |
| job-scan | `finishedGoods/jobScanLocations:resolve` | 15 | 6.2 | 20.47 | 18.61 | 1 | 0.6 |  |
| job-scan | `finishedGoods/scanning:resolveLocationCode` | 13 | 5.0 | 15.93 | 15.49 | 1 | 0.5 |  |
| hr-self | `hr/self:today` | 13 | 5.8 | 14.43 | 12.98 | 1 | 0.8 |  |
| fg-product | `finishedGoods/catalogue:productSummary` | 12 | 4.3 | 22.7 | 22.62 | 1 | 0.3 |  |
| hr-self | `hr/self:profile` | 12 | 4.1 | 13.19 | 11.68 | 1 | 0.6 |  |
| hr-self | `hr/self:history` | 12 | 5.6 | 15.17 | 11.64 | 1 | 1.6 |  |
| shell | `aiUsage/reports:access` | 11 | 3.4 | 23.66 | 27.16 | 1 | 0.2 |  |
| fg-product | `finishedGoods/batches:getBatch` | 11 | 3.7 | 37.49 | 43.73 | 1 | 1.0 |  |
| storage | `storageLayouts/catalogue:buildingStatusControl` | 11 | 4.4 | 13.37 | 11.03 | 1 | 0.1 |  |
| hr-admin | `hr/leave:queuePage` | 11 | 3.4 | 16.59 | 13.2 | 1 | 0.2 |  |
| fg-product | `finishedGoods/workflow:getProduct` | 10 | 3.4 | 36.09 | 30.95 | 1 | 0.7 |  |
| fg-pallet | `finishedGoods/history:palletMoveHistory` | 10 | 3.4 | 15.51 | 13.93 | 1 | 0.1 |  |
| fg-pallet | `finishedGoods/workflow:stackChoices` | 10 | 3.4 | 11.64 | 11.73 | 1 | 0.1 |  |
| job-scan | `finishedGoods/scanning:resolvePackageCode` | 10 | 3.5 | 13.27 | 13.96 | 1 | 0.1 | NOT_OK |
| hr-self | `hr/self:requests` | 10 | 4.3 | 17.25 | 11.34 | 1 | 0.6 |  |
| hr-admin | `hr/periods:listPage` | 10 | 3.4 | 12.31 | 10.82 | 1 | 0.5 |  |
| fg-product | `finishedGoods/batches:pageProductBatches` | 9 | 2.9 | 145.19 | 44.55 | 1 | 0.1 |  |
| job-scan | `finishedGoods/jobScanLocations:page` | 9 | 2.9 | 15.51 | 13.35 | 1 | 0.2 |  |
| hr-self | `hr/announcements:self` | 9 | 3.4 | 12.4 | 10.93 | 1 | 0.1 |  |
| hr-self | `hr/notifications:list` | 9 | 3.4 | 12 | 11.31 | 1 | 0.2 |  |
| hr-self | `hr/leave:self` | 9 | 3.4 | 12.88 | 11.71 | 1 | 0.3 |  |
| hr-admin | `hr/roster:shifts` | 9 | 2.8 | 11.67 | 10.86 | 1 | 0.2 |  |
| hr-admin | `hr/payslips:list` | 9 | 3.4 | 14.53 | 11.74 | 1 | 0.1 | POLICY_NOT_ACTIVE |
| hr-admin | `hr/payslips:imports` | 8 | 2.7 | 12.46 | 10.65 | 1 | 0.1 | POLICY_NOT_ACTIVE |
| hr-admin | `hr/org:listDepartments` | 8 | 2.7 | 19.31 | 18.89 | 1 | 0.1 |  |
| ai-usage | `aiUsage/reports:summary` | 8 | 2.7 | 34.51 | 28.84 | 1 | 1.2 |  |
| ai-usage | `aiUsage/reports:recent` | 8 | 2.7 | 31.52 | 28.37 | 1 | 0.1 |  |

**candidate: write flows**

| Flow | Function | Docs read | Docs written | Index rows | Exec p50 ms |
|---|---|---:|---:|---:|---:|
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:saveJobScans` | 18 | 28 | 125 | 57.96 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:updateJobScan` | 95 | 35 | 154 | 50.3 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:deleteJobScans` | 85 | 26 | 117 | 59.76 |
| job-scan save batch of 50 (max) | `finishedGoods/jobScans:saveJobScans` | 263 | 1253 | 5368 | 500.94 |
| job-scan delete batch of 50 | `finishedGoods/jobScans:saveJobScans` | 263 | 1253 | 5368 | 578 |
| job-scan delete batch of 50 | `finishedGoods/jobScans:deleteJobScans` | 3766 | 1253 | 5368 | 940.19 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve` | 37 | 9 | 58 | 73.07 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` | 32 | 8 | 59 | 76.1 |
| pallet measurement save | `finishedGoods/workflow:saveMeasurement` | 23 | 5 | 33 | 39.27 |

**candidate: reactive fan-out** (61 subscriptions open on one session)

| Write | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions |
|---|---|---:|---:|---:|---:|---:|---|
| saveJobScans (1 item) | 18 / 18 / 13.3 | 2 | 122 | 64.1 | 126.9 | 0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs) |
| reserve (awaiting pallet) | 40 / 9 / 9.2 | 6 | 1052 | 1591.2 | 2265.9 | 0 (0) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/workflow:recommendationZone×1 (16 docs); finishedGoods/catalogue:page×2 (147 docs); finishedGoods/workflow:recommend×1 (439 docs); finishedGoods/workflow:recommendMove×1 (440 docs) |
| cancelReservation (same pallet) | 35 / 8 / 8.4 | 6 | 1052 | 1590.1 | 2728.7 | 0 (0) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/workflow:recommendationZone×1 (16 docs); finishedGoods/catalogue:page×2 (147 docs); finishedGoods/workflow:recommend×1 (439 docs); finishedGoods/workflow:recommendMove×1 (440 docs) |
| createPallet (busiest product) | 25 / 9 / 6.9 | 6 | 321 | 170.7 | 1565.2 | 0 (0) | finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/catalogue:summary×1 (18 docs); finishedGoods/catalogue:page×3 (260 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs) |

**candidate: contention** 8 concurrent saveJobScans × 3 rounds → executions 24, OCC retries 0 (per round 0/0/0), failures 0, RTT p50 421.9 ms / max 832.6 ms

**candidate: contention** 8 concurrent createPallet (same product) × 3 rounds → executions 79, OCC retries 56 (per round 19/21/16), failures 1, RTT p50 604.6 ms / max 1746.7 ms

**candidate: contention** 8 concurrent createPallet (different products) × 3 rounds → executions 74, OCC retries 52 (per round 19/18/15), failures 2, RTT p50 711.1 ms / max 1943 ms

**candidate: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 14, OCC retries 6, failures 0, RTT p50 322.4 ms / max 710.9 ms

**candidate: contention** 8 concurrent reserve (one dense zone, distinct pallets) → executions 15, OCC retries 7, failures 7, RTT p50 656.3 ms / max 703.9 ms

**base: write flows**

| Flow | Function | Docs read | Docs written | Index rows | Exec p50 ms |
|---|---|---:|---:|---:|---:|
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:saveJobScans` | 10 | 4 | 22 | 22.07 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:updateJobScan` | 13 | 4 | 22 | 25.82 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:deleteJobScans` | 13 | 4 | 22 | 30.91 |
| job-scan save batch of 50 (max) | `finishedGoods/jobScans:saveJobScans` | 10 | 53 | 218 | 36.4 |
| job-scan delete batch of 50 | `finishedGoods/jobScans:saveJobScans` | 10 | 53 | 218 | 32.94 |
| job-scan delete batch of 50 | `finishedGoods/jobScans:deleteJobScans` | 160 | 53 | 218 | 88.54 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve` | 28 | 7 | 47 | 101.14 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` | 23 | 6 | 48 | 33.34 |
| pallet measurement save | `finishedGoods/workflow:saveMeasurement` | 21 | 5 | 33 | 72.09 |

**base: reactive fan-out** (60 subscriptions open on one session)

| Write | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions |
|---|---|---:|---:|---:|---:|---:|---|
| saveJobScans (1 item) | 10 / 4 / 3.7 | 2 | 122 | 64.0 | 146.9 | 0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs) |
| reserve (awaiting pallet) (error: no recommended destination: undefined) | – | 0 | 0 | 0.0 | 0 | 0 (0) |  |
| cancelReservation (same pallet) | 20 / 5 / 5.0 | 9 | 1814 | 1192.1 | 6581.8 | 3 (334) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/workflow:recommend×1 (1491 docs) |
| createPallet (busiest product) | 22 / 8 / 6.4 | 7 | 316 | 168.1 | 2325.2 | 3 (334) | finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (252 docs) |

**base: contention** 8 concurrent saveJobScans × 3 rounds → executions 24, OCC retries 0 (per round 0/0/0), failures 0, RTT p50 155.1 ms / max 208.5 ms

**base: contention** 8 concurrent createPallet (same product) × 3 rounds → executions 82, OCC retries 63 (per round 22/18/23), failures 5, RTT p50 1283 ms / max 3293.5 ms

**base: contention** 8 concurrent createPallet (different products) × 3 rounds → executions 83, OCC retries 64 (per round 20/22/22), failures 5, RTT p50 922.8 ms / max 1777.2 ms

**base: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 27, OCC retries 19, failures 0, RTT p50 852.3 ms / max 2142.3 ms

**base: contention** 7 concurrent reserve (one dense zone, distinct pallets) → executions 13, OCC retries 6, failures 6, RTT p50 509 ms / max 584.9 ms
