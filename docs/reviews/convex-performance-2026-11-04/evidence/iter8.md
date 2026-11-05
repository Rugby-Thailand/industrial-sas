Profile `iter8` · 2026-11-05T07:56:19.772Z · 7 uncached samples per target (p50) · dataset {"pallets":1305,"products":126,"zones":421,"buildings":127,"jobScans":2182,"employees":153}
Targets: candidate@3308eee9 (convex sha256:ec7564df058c0f30), base@80dc0a93 (convex sha256:a486b726209f5b84) · load avg before/after 8.3/5.6

| Screen | Function | Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note |
|---|---|---:|---:|---:|---:|---:|---:|---|
| storage | `storageLayouts/catalogue:getStorageBuilding` | 1844 | 1328.2 | 192.38 | 184.09 | 1 | 453.4 | legacy (no live subscriber) |
| fg-pallet | `finishedGoods/workflow:list` | 1440 | 914.8 | 196.5 | 175.25 | 1 | 925.4 | legacy (no live subscriber) |
| storage | `storageLayouts/catalogue:getStorageLocationMap` | 936 | 671.6 | 111.72 | 115.39 | 1 | 376.2 | legacy (no live subscriber) |
| hr-admin | `hr/roster:roster` (previous month) | 594 | 331.2 | 52.38 | 0.14 | 1 | 152.0 |  |
| fg-pallet | `finishedGoods/workflow:recommendMove` (list) | 439 (was 688) | 747.7 | 112.72 | 0.15 | 1 | 128.0 |  |
| fg-pallet | `finishedGoods/workflow:recommendMove` (full payload) | 439 (was 688) | 747.7 | 127.63 | 399.02 | 1 | 238.5 | legacy (no live subscriber) |
| fg-pallet | `finishedGoods/workflow:recommend` (list) | 438 (was 687) | 746.9 | 120.64 | 0.15 | 1 | 127.7 |  |
| fg-pallet | `finishedGoods/workflow:recommend` (full payload) | 438 (was 687) | 746.9 | 110.97 | 386.7 | 1 | 238.3 | legacy (no live subscriber) |
| storage | `storageLayouts/locationCatalogue:detail` | 312 | 274.5 | 87.16 | 86.2 | 1 | 62.6 |  |
| hr-admin | `hr/roster:roster` (no page size) | 253 | 154.2 | 49.29 | 16.23 | 1 | 0.1 | LIMIT_EXCEEDED |
| hr-admin | `hr/review:queuePage` | 251 | 139.4 | 75.66 | 70.66 | 2 | 10.0 |  |
| job-scan | `finishedGoods/jobScanLocations:options` | 218 | 134.8 | 30.12 | 29.09 | 1 | 13.2 |  |
| hr-admin | `hr/setup:employeesPage` | 141 | 83.6 | 25.45 | 20.68 | 1 | 15.0 |  |
| hr-admin | `hr/periods:preview` | 111 (was 164) | 76.0 | 17.8 | 17.64 | 1 | 0.8 |  |
| hr-admin | `hr/search:adminEmployees` | 111 | 75.2 | 16.86 | 13.78 | 1 | 1.5 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (products tab) | 110 | 55.2 | 29.67 | 25.87 | 1 | 74.0 |  |
| storage | `storageLayouts/locationCatalogue:options` | 109 | 69.1 | 14.92 | 12.81 | 1 | 14.5 |  |
| job-scan | `finishedGoods/jobScanLocations:searchPage` (hit) | 98 | 37.9 | 18.72 | 154.18 | 1 | 1.3 |  |
| hr-admin | `hr/roster:roster` | 84 | 47.9 | 41.59 | 0.16 | 1 | 131.1 |  |
| storage | `storageLayouts/locationCatalogue:page` | 83 | 52.8 | 22.12 | 21.46 | 1 | 25.8 |  |
| fg-pallet | `finishedGoods/workflow:getPallet` | 75 | 50.9 | 26.3 | 30.84 | 1 | 2.3 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets tab) | 65 | 39.2 | 41.32 | 35.14 | 1 | 75.3 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets search) | 65 | 39.2 | 52.5 | 46.62 | 1 | 75.3 |  |
| job-scan | `finishedGoods/jobScans:listJobScans` (search) | 61 | 26.5 | 57.19 | 528.87 | 1 | 3.8 |  |
| job-scan | `finishedGoods/jobScanLocations:buildingOptions` | 61 | 37.8 | 15.7 | 14.51 | 1 | 7.7 |  |
| job-scan | `finishedGoods/jobScans:listJobScans` | 60 | 36.9 | 35.82 | 31.12 | 1 | 21.3 |  |
| job-scan | `finishedGoods/jobScans:listJobScans` (unmapped) | 60 | 37.0 | 34.71 | 29.85 | 1 | 21.3 |  |
| job-scan | `finishedGoods/jobScanLocations:searchPage` | 39 | 16.0 | 19.93 | 150.38 | 1 | 0.2 |  |
| storage | `storageLayouts/catalogue:getStorageBuildingInventory` | 35 | 469.4 | 53.08 | 205.58 | 1 | 447.8 |  |
| fg-product | `finishedGoods/batches:pageLegacyUnits` | 30 | 17.4 | 22.02 | 20.34 | 1 | 15.8 |  |
| storage | `storageLayouts/catalogue:listStorageBuildingsPage` | 29 | 16.2 | 16.55 | 17.44 | 1 | 13.7 |  |
| hr-admin | `hr/periods:versionRowsPage` | 29 | 16.3 | 14.09 | 10.84 | 1 | 9.4 |  |
| hr-admin | `hr/setup:accessMembersPage` | 26 | 8.4 | 14 | 10.72 | 1 | 0.6 |  |
| storage | `storageLayouts/catalogue:getStorageBuildingLayout` | 25 | 14.3 | 14.01 | 13.41 | 1 | 7.4 |  |
| storage | `storageLayouts/writes:layoutReadiness` | 25 | 14.3 | 15.39 | 12.97 | 1 | 1.9 |  |
| storage | `storageLayouts/catalogue:buildingOccupancy` | 21 | 8.6 | 13.7 | 97.36 | 1 | 1.0 |  |
| hr-admin | `hr/setup:employee` | 19 | 6.2 | 12.67 | 9.93 | 1 | 0.6 |  |
| fg-catalogue | `finishedGoods/catalogue:summary` | 18 | 6.9 | 11.5 | 47.34 | 1 | 0.3 |  |
| ai-usage | `aiUsage/dimensions:actorOptions` | 17 | 5.3 | 11.37 | 9.28 | 1 | 0.4 |  |
| shell | `workspace/current:readCurrent` | 16 | 5.0 | 11.48 | 9.64 | 1 | 0.5 |  |
| shell | `hr/access:display` | 16 | 5.3 | 12.36 | 10.74 | 1 | 0.7 |  |
| fg-pallet | `finishedGoods/workflow:recommendationZone` (viewed zone) | 16 (was 17) | 6.2 | 15.29 | 0.11 | 1 | 0.6 |  |
| fg-pallet | `finishedGoods/workflow:recommendationZone` (move: viewed zone) | 16 (was 17) | 6.4 | 14.54 | 0.1 | 1 | 0.6 |  |
| fg-pallet | `finishedGoods/workflow:recommendationZone` (switched zone) | 16 | 6.2 | 15.33 | 0.09 | 1 | 0.6 |  |
| job-scan | `finishedGoods/jobScanLocations:resolve` | 15 | 6.2 | 12.49 | 12.21 | 1 | 0.6 |  |
| job-scan | `finishedGoods/scanning:resolveLocationCode` | 13 | 5.0 | 11.95 | 11.61 | 1 | 0.5 |  |
| hr-self | `hr/self:today` | 13 | 5.8 | 14.32 | 11.83 | 1 | 0.8 |  |
| fg-product | `finishedGoods/catalogue:productSummary` | 12 | 4.3 | 12.36 | 11.24 | 1 | 0.3 |  |
| hr-self | `hr/self:profile` | 12 | 4.1 | 11.93 | 10.95 | 1 | 0.6 |  |
| hr-self | `hr/self:history` | 12 | 5.6 | 13.08 | 11.18 | 1 | 1.6 |  |
| shell | `aiUsage/reports:access` | 11 | 3.4 | 10.9 | 8.98 | 1 | 0.2 |  |
| fg-product | `finishedGoods/batches:getBatch` | 11 | 3.7 | 12.86 | 13.18 | 1 | 1.0 |  |
| storage | `storageLayouts/catalogue:buildingStatusControl` | 11 | 4.4 | 13.99 | 12.16 | 1 | 0.1 |  |
| hr-admin | `hr/leave:queuePage` | 11 | 3.4 | 11.99 | 9.4 | 1 | 0.2 |  |
| fg-product | `finishedGoods/workflow:getProduct` | 10 | 3.4 | 28.66 | 26.87 | 1 | 0.7 |  |
| fg-pallet | `finishedGoods/history:palletMoveHistory` | 10 | 3.4 | 11.09 | 10.11 | 1 | 0.1 |  |
| fg-pallet | `finishedGoods/workflow:stackChoices` | 10 | 3.4 | 12.76 | 10.93 | 1 | 0.1 |  |
| job-scan | `finishedGoods/scanning:resolvePackageCode` | 10 | 3.5 | 12.35 | 10.94 | 1 | 0.1 | NOT_OK |
| hr-self | `hr/self:requests` | 10 | 4.3 | 12.62 | 10.21 | 1 | 0.6 |  |
| hr-admin | `hr/periods:listPage` | 10 | 3.4 | 11.93 | 9.31 | 1 | 0.5 |  |
| fg-product | `finishedGoods/batches:pageProductBatches` | 9 | 2.9 | 11.86 | 10.03 | 1 | 0.1 |  |
| job-scan | `finishedGoods/jobScanLocations:page` | 9 | 2.9 | 12.02 | 11.65 | 1 | 0.2 |  |
| hr-self | `hr/announcements:self` | 9 | 3.4 | 12.31 | 10.69 | 1 | 0.1 |  |
| hr-self | `hr/notifications:list` | 9 | 3.4 | 11.28 | 9.05 | 1 | 0.2 |  |
| hr-self | `hr/leave:self` | 9 | 3.4 | 13.4 | 10.98 | 1 | 0.3 |  |
| hr-admin | `hr/roster:shifts` | 9 | 2.8 | 10.62 | 8.64 | 1 | 0.2 |  |
| hr-admin | `hr/payslips:list` | 9 | 3.4 | 11.5 | 9.67 | 1 | 0.1 | POLICY_NOT_ACTIVE |
| hr-admin | `hr/payslips:imports` | 8 | 2.7 | 11.61 | 8.91 | 1 | 0.1 | POLICY_NOT_ACTIVE |
| hr-admin | `hr/org:listDepartments` | 8 | 2.7 | 10.85 | 8.57 | 1 | 0.1 |  |
| ai-usage | `aiUsage/reports:summary` | 8 | 2.7 | 11.2 | 8.95 | 1 | 1.2 |  |
| ai-usage | `aiUsage/reports:recent` | 8 | 2.7 | 10.99 | 8.68 | 1 | 0.1 |  |

**candidate: write flows**

| Flow | Function | Docs read | Docs written | Index rows | Exec p50 ms |
|---|---|---:|---:|---:|---:|
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:saveJobScans` | 18 | 28 | 125 | 16.67 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:updateJobScan` | 95 | 35 | 154 | 21.19 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:deleteJobScans` | 85 | 26 | 117 | 18.78 |
| job-scan save batch of 50 (max) | `finishedGoods/jobScans:saveJobScans` | 263 | 1253 | 5368 | 145.36 |
| job-scan delete batch of 50 | `finishedGoods/jobScans:saveJobScans` | 263 | 1253 | 5368 | 138.25 |
| job-scan delete batch of 50 | `finishedGoods/jobScans:deleteJobScans` | 3766 | 1253 | 5368 | 207.22 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve` | 37 | 9 | 58 | 18.1 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` | 32 | 8 | 59 | 15.61 |
| pallet measurement save | `finishedGoods/workflow:saveMeasurement` | 23 | 5 | 33 | 17.55 |

**candidate: reactive fan-out** (61 subscriptions open on one session)

| Write | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions |
|---|---|---:|---:|---:|---:|---:|---|
| saveJobScans (1 item) | 18 / 18 / 13.3 | 3 | 183 | 90.5 | 333.3 | 0 (0) | finishedGoods/jobScans:listJobScans×3 (183 docs) |
| reserve (awaiting pallet) | 40 / 9 / 9.2 | 6 | 1051 | 1590.9 | 617.7 | 0 (0) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/workflow:recommendationZone×1 (16 docs); finishedGoods/catalogue:page×2 (146 docs); finishedGoods/workflow:recommendMove×1 (440 docs); finishedGoods/workflow:recommend×1 (439 docs) |
| cancelReservation (same pallet) | 32 / 8 / 8.4 | 6 | 1052 | 1590.1 | 492.2 | 0 (0) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/workflow:recommendationZone×1 (16 docs); finishedGoods/catalogue:page×2 (147 docs); finishedGoods/workflow:recommend×1 (439 docs); finishedGoods/workflow:recommendMove×1 (440 docs) |
| createPallet (busiest product) | 28 / 9 / 6.9 | 6 | 320 | 170.4 | 202.4 | 0 (0) | finishedGoods/catalogue:summary×1 (18 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (259 docs) |

**candidate: contention** 8 concurrent saveJobScans × 3 rounds → executions 24, OCC retries 0 (per round 0/0/0), failures 0, RTT p50 123.2 ms / max 193 ms

**candidate: contention** 8 concurrent createPallet (same product) × 3 rounds → executions 63, OCC retries 39 (per round 12/13/14), failures 0, RTT p50 236.2 ms / max 758.2 ms

**candidate: contention** 8 concurrent createPallet (different products) × 3 rounds → executions 63, OCC retries 39 (per round 15/13/11), failures 0, RTT p50 215.8 ms / max 665.5 ms

**candidate: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 9, OCC retries 1, failures 0, RTT p50 67.9 ms / max 141.1 ms

**candidate: contention** 8 concurrent reserve (one dense zone, distinct pallets) → executions 15, OCC retries 7, failures 7, RTT p50 97.5 ms / max 117.3 ms

**base: write flows**

| Flow | Function | Docs read | Docs written | Index rows | Exec p50 ms |
|---|---|---:|---:|---:|---:|
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:saveJobScans` | 10 | 4 | 22 | 10.54 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:updateJobScan` | 13 | 4 | 22 | 11.36 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:deleteJobScans` | 13 | 4 | 22 | 11.09 |
| job-scan save batch of 50 (max) | `finishedGoods/jobScans:saveJobScans` | 10 | 53 | 218 | 14.82 |
| job-scan delete batch of 50 | `finishedGoods/jobScans:saveJobScans` | 10 | 53 | 218 | 14.78 |
| job-scan delete batch of 50 | `finishedGoods/jobScans:deleteJobScans` | 160 | 53 | 218 | 19.33 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve` | 28 | 7 | 47 | 12.78 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` | 23 | 6 | 48 | 11.65 |
| pallet measurement save | `finishedGoods/workflow:saveMeasurement` | 21 | 5 | 33 | 10.86 |

**base: reactive fan-out** (60 subscriptions open on one session)

| Write | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions |
|---|---|---:|---:|---:|---:|---:|---|
| saveJobScans (1 item) | 10 / 4 / 3.7 | 2 | 122 | 64.1 | 37.6 | 0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs) |
| reserve (awaiting pallet) | 28 / 7 / 7.2 | 10 | 6098 | 3808.1 | 1918.5 | 3 (334) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/workflow:recommendMove×1 (2888 docs); finishedGoods/workflow:recommend×1 (2887 docs) |
| cancelReservation (same pallet) | 23 / 6 / 6.8 | 10 | 6096 | 3806.3 | 1217 | 3 (334) | finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/workflow:recommendMove×1 (2887 docs); finishedGoods/workflow:recommend×1 (2886 docs) |
| createPallet (busiest product) | 22 / 8 / 6.4 | 7 | 316 | 168.1 | 194.3 | 3 (334) | finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (252 docs) |

**base: contention** 8 concurrent saveJobScans × 3 rounds → executions 24, OCC retries 0 (per round 0/0/0), failures 0, RTT p50 45.8 ms / max 60.7 ms

**base: contention** 8 concurrent createPallet (same product) × 3 rounds → executions 66, OCC retries 42 (per round 15/14/13), failures 0, RTT p50 147.7 ms / max 660.6 ms

**base: contention** 8 concurrent createPallet (different products) × 3 rounds → executions 66, OCC retries 42 (per round 13/13/16), failures 0, RTT p50 176.9 ms / max 681.6 ms

**base: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 21, OCC retries 13, failures 0, RTT p50 277.2 ms / max 433.2 ms

**base: contention** 8 concurrent reserve (one dense zone, distinct pallets) → executions 15, OCC retries 7, failures 7, RTT p50 124.3 ms / max 190.6 ms
