Profile `iter10` · 2026-11-05T09:52:11.124Z · 7 uncached samples per target (p50) · dataset {"pallets":1305,"products":126,"zones":421,"buildings":127,"jobScans":2182,"employees":153}
Targets: candidate@ad175269 (convex sha256:af5ae17ff5f5dc78), base@80dc0a93 (convex sha256:a486b726209f5b84) · load avg before/after 23.9/22.2

| Screen | Function | Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note |
|---|---|---:|---:|---:|---:|---:|---:|---|
| storage | `storageLayouts/catalogue:getStorageBuilding` | 1844 | 1328.2 | 206.75 | 356.88 | 1 | 453.4 | legacy (no live subscriber) |
| fg-pallet | `finishedGoods/workflow:list` | 1440 | 914.8 | 167.26 | 165.31 | 1 | 925.4 | legacy (no live subscriber) |
| storage | `storageLayouts/catalogue:getStorageLocationMap` | 936 | 671.6 | 146.14 | 110.32 | 1 | 376.2 | legacy (no live subscriber) |
| hr-admin | `hr/roster:roster` (previous month) | 594 | 331.2 | 54.37 | 17.91 | 1 | 152.0 |  |
| fg-pallet | `finishedGoods/workflow:recommendMove` (list) | 439 | 747.7 | 89.45 | 341.42 | 1 | 128.0 |  |
| fg-pallet | `finishedGoods/workflow:recommendMove` (full payload) | 439 | 747.7 | 106.7 | 369.87 | 1 | 238.5 | legacy (no live subscriber) |
| fg-pallet | `finishedGoods/workflow:recommend` (list) | 438 | 746.9 | 112.65 | 424.53 | 1 | 127.7 |  |
| fg-pallet | `finishedGoods/workflow:recommend` (full payload) | 438 | 746.9 | 102.2 | 369.31 | 1 | 238.3 | legacy (no live subscriber) |
| storage | `storageLayouts/locationCatalogue:detail` | 312 | 274.5 | 88.63 | 89.18 | 1 | 62.6 |  |
| hr-admin | `hr/review:queuePage` | 251 | 139.4 | 80.1 | 70.86 | 2 | 10.0 |  |
| job-scan | `finishedGoods/jobScanLocations:options` | 218 | 134.8 | 30.33 | 32.69 | 1 | 13.2 |  |
| hr-admin | `hr/setup:employeesPage` | 141 | 83.6 | 45.59 | 30.62 | 1 | 15.0 |  |
| hr-admin | `hr/periods:preview` | 111 | 76.0 | 28.47 | 24.17 | 1 | 0.8 |  |
| hr-admin | `hr/search:adminEmployees` | 111 | 75.2 | 16.98 | 16 | 1 | 1.5 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (products tab) | 110 | 55.2 | 26.3 | 24.8 | 1 | 74.0 |  |
| storage | `storageLayouts/locationCatalogue:options` | 109 | 69.1 | 33.43 | 37.88 | 1 | 14.5 |  |
| hr-admin | `hr/roster:roster` (no page size) | 109 (was 253) | 74.7 | 15.99 | 18.58 | 1 | 0.1 | LIMIT_EXCEEDED |
| job-scan | `finishedGoods/jobScanLocations:searchPage` (hit) | 98 | 37.9 | 16.38 | 154.66 | 1 | 1.3 |  |
| hr-admin | `hr/roster:roster` | 84 | 47.9 | 45.46 | 21.14 | 1 | 131.1 |  |
| storage | `storageLayouts/locationCatalogue:page` | 83 | 52.8 | 21.57 | 25.11 | 1 | 25.8 |  |
| fg-pallet | `finishedGoods/workflow:getPallet` | 75 | 50.9 | 207.89 | 276.1 | 1 | 2.3 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets tab) | 65 | 39.2 | 45.8 | 37.51 | 1 | 75.3 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets search) | 65 | 39.2 | 43.17 | 41.19 | 1 | 75.3 |  |
| job-scan | `finishedGoods/jobScans:listJobScans` (search) | 61 | 26.5 | 98.44 | 644.95 | 1 | 3.8 |  |
| job-scan | `finishedGoods/jobScanLocations:buildingOptions` | 61 | 37.8 | 13.89 | 12.48 | 1 | 7.7 |  |
| job-scan | `finishedGoods/jobScans:listJobScans` | 60 | 36.9 | 33.06 | 33.1 | 1 | 21.3 |  |
| job-scan | `finishedGoods/jobScans:listJobScans` (unmapped) | 60 | 37.0 | 31.3 | 30.68 | 1 | 21.3 |  |
| job-scan | `finishedGoods/jobScanLocations:searchPage` | 39 | 16.0 | 19.06 | 133.18 | 1 | 0.2 |  |
| storage | `storageLayouts/catalogue:getStorageBuildingInventory` | 35 | 469.4 | 53.87 | 260.95 | 1 | 447.8 |  |
| fg-product | `finishedGoods/batches:pageLegacyUnits` | 30 | 17.4 | 23.39 | 18.87 | 1 | 15.8 |  |
| storage | `storageLayouts/catalogue:listStorageBuildingsPage` | 29 | 16.2 | 11.09 | 11.89 | 1 | 13.7 |  |
| hr-admin | `hr/periods:versionRowsPage` | 29 | 16.3 | 19.39 | 13.83 | 1 | 9.4 |  |
| hr-admin | `hr/setup:accessMembersPage` | 26 | 8.4 | 20.11 | 23.5 | 1 | 0.6 |  |
| storage | `storageLayouts/catalogue:getStorageBuildingLayout` | 25 | 14.3 | 14.5 | 13.43 | 1 | 7.4 |  |
| storage | `storageLayouts/writes:layoutReadiness` | 25 | 14.3 | 20.06 | 13.66 | 1 | 1.9 |  |
| storage | `storageLayouts/catalogue:buildingOccupancy` | 21 | 8.6 | 21.06 | 99.01 | 1 | 1.0 |  |
| hr-admin | `hr/setup:employee` | 19 | 6.2 | 11.63 | 10.17 | 1 | 0.6 |  |
| fg-catalogue | `finishedGoods/catalogue:summary` | 18 | 6.9 | 18.05 | 68.69 | 1 | 0.3 |  |
| ai-usage | `aiUsage/dimensions:actorOptions` | 17 | 5.3 | 14.81 | 19.17 | 1 | 0.4 |  |
| shell | `workspace/current:readCurrent` | 16 | 5.0 | 60.2 | 40.85 | 1 | 0.5 |  |
| shell | `hr/access:display` | 16 | 5.3 | 27.74 | 23.8 | 1 | 0.7 |  |
| fg-pallet | `finishedGoods/workflow:recommendationZone` (viewed zone) | 16 | 6.2 | 11.85 | – | 1 | 0.6 |  |
| fg-pallet | `finishedGoods/workflow:recommendationZone` (move: viewed zone) | 16 | 6.4 | 12.31 | – | 1 | 0.6 |  |
| fg-pallet | `finishedGoods/workflow:recommendationZone` (switched zone) | 16 | 6.2 | 12.52 | – | 1 | 0.6 |  |
| job-scan | `finishedGoods/jobScanLocations:resolve` | 15 | 6.2 | 23.16 | 30.27 | 1 | 0.6 |  |
| job-scan | `finishedGoods/scanning:resolveLocationCode` | 13 | 5.0 | 11.03 | 11.9 | 1 | 0.5 |  |
| hr-self | `hr/self:today` | 13 | 5.8 | 12.89 | 16.06 | 1 | 0.8 |  |
| fg-product | `finishedGoods/catalogue:productSummary` | 12 | 4.3 | 14.39 | 10.95 | 1 | 0.3 |  |
| hr-self | `hr/self:profile` | 12 | 4.1 | 11.99 | 9.91 | 1 | 0.6 |  |
| hr-self | `hr/self:history` | 12 | 5.6 | 11.81 | 10.48 | 1 | 1.6 |  |
| shell | `aiUsage/reports:access` | 11 | 3.4 | 11.99 | 9.84 | 1 | 0.2 |  |
| fg-product | `finishedGoods/batches:getBatch` | 11 | 3.7 | 17.77 | 14.79 | 1 | 1.0 |  |
| storage | `storageLayouts/catalogue:buildingStatusControl` | 11 | 4.4 | 10.48 | 10.17 | 1 | 0.1 |  |
| hr-admin | `hr/leave:queuePage` | 11 | 3.4 | 14.8 | 19.53 | 1 | 0.2 |  |
| fg-product | `finishedGoods/workflow:getProduct` | 10 | 3.4 | 12.28 | 10.65 | 1 | 0.7 |  |
| fg-pallet | `finishedGoods/history:palletMoveHistory` | 10 | 3.4 | 71.22 | 88.45 | 1 | 0.1 |  |
| fg-pallet | `finishedGoods/workflow:stackChoices` | 10 | 3.4 | 9.76 | 9.19 | 1 | 0.1 |  |
| job-scan | `finishedGoods/scanning:resolvePackageCode` | 10 | 3.5 | 9.94 | 11.64 | 1 | 0.1 | NOT_OK |
| hr-self | `hr/self:requests` | 10 | 4.3 | 23.34 | 18.61 | 1 | 0.6 |  |
| hr-admin | `hr/periods:listPage` | 10 | 3.4 | 21.36 | 13.25 | 1 | 0.5 |  |
| fg-product | `finishedGoods/batches:pageProductBatches` | 9 | 2.9 | 11.63 | 10.66 | 1 | 0.1 |  |
| job-scan | `finishedGoods/jobScanLocations:page` | 9 | 2.9 | 17.24 | 11.43 | 1 | 0.2 |  |
| hr-self | `hr/announcements:self` | 9 | 3.4 | 10.63 | 9.45 | 1 | 0.1 |  |
| hr-self | `hr/notifications:list` | 9 | 3.4 | 12.48 | 9.25 | 1 | 0.2 |  |
| hr-self | `hr/leave:self` | 9 | 3.4 | 11.52 | 10.85 | 1 | 0.3 |  |
| hr-admin | `hr/roster:shifts` | 9 | 2.8 | 12.31 | 10.1 | 1 | 0.2 |  |
| hr-admin | `hr/payslips:list` | 9 | 3.4 | 19 | 16.28 | 1 | 0.1 | POLICY_NOT_ACTIVE |
| hr-admin | `hr/payslips:imports` | 8 | 2.7 | 11.73 | 9.34 | 1 | 0.1 | POLICY_NOT_ACTIVE |
| hr-admin | `hr/org:listDepartments` | 8 | 2.7 | 21.22 | 19.72 | 1 | 0.1 |  |
| ai-usage | `aiUsage/reports:summary` | 8 | 2.7 | 14.32 | 29.51 | 1 | 1.2 |  |
| ai-usage | `aiUsage/reports:recent` | 8 | 2.7 | 10.68 | 9.2 | 1 | 0.1 |  |

**candidate: write flows**

| Flow | Function | Docs read | Docs written | Index rows | Exec p50 ms |
|---|---|---:|---:|---:|---:|
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:saveJobScans` | 18 | 28 | 125 | 37.15 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:updateJobScan` | 95 | 35 | 154 | 52.73 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:deleteJobScans` | 85 | 26 | 117 | 70.86 |
| job-scan save batch of 50 (max) | `finishedGoods/jobScans:saveJobScans` | 263 | 1253 | 5368 | 300.18 |
| job-scan delete batch of 50 | `finishedGoods/jobScans:saveJobScans` | 263 | 1353 | 5768 | 177.72 |
| job-scan delete batch of 50 | `finishedGoods/jobScans:deleteJobScans` | 4066 | 1353 | 5768 | 326.81 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve` | 37 | 9 | 58 | 25.92 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` | 32 | 8 | 59 | 15.69 |
| pallet measurement save | `finishedGoods/workflow:saveMeasurement` | 23 | 5 | 33 | 40.63 |

**candidate: reactive fan-out** (61 subscriptions open on one session)

| Write | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions |
|---|---|---:|---:|---:|---:|---:|---|
| saveJobScans (1 item) | 18 / 18 / 13.3 | 3 | 183 | 90.5 | 509.5 | 0 (0) | finishedGoods/jobScans:listJobScans×3 (183 docs) |
| reserve (awaiting pallet) | 40 / 9 / 9.2 | 6 | 1053 | 1591.5 | 554.9 | 0 (0) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/workflow:recommendationZone×1 (16 docs); finishedGoods/catalogue:page×2 (148 docs); finishedGoods/workflow:recommend×1 (439 docs); finishedGoods/workflow:recommendMove×1 (440 docs) |
| cancelReservation (same pallet) | 35 / 8 / 8.4 | 6 | 1053 | 1590.4 | 742.6 | 0 (0) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/workflow:recommendationZone×1 (16 docs); finishedGoods/catalogue:page×2 (148 docs); finishedGoods/workflow:recommendMove×1 (440 docs); finishedGoods/workflow:recommend×1 (439 docs) |
| createPallet (busiest product) | 28 / 9 / 6.9 | 6 | 321 | 170.7 | 484.2 | 0 (0) | finishedGoods/catalogue:summary×1 (18 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (260 docs) |

**candidate: contention** 8 concurrent saveJobScans × 3 rounds → executions 24, OCC retries 0 (per round 0/0/0), failures 0, RTT p50 160 ms / max 273.3 ms

**candidate: contention** 8 concurrent createPallet (same product) × 3 rounds → executions 67, OCC retries 43 (per round 14/15/14), failures 0, RTT p50 332.1 ms / max 790.9 ms

**candidate: contention** 8 concurrent createPallet (different products) × 3 rounds → executions 75, OCC retries 52 (per round 17/16/19), failures 1, RTT p50 744.2 ms / max 1565.9 ms

**candidate: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 10, OCC retries 2, failures 0, RTT p50 249 ms / max 412.1 ms

**candidate: contention** 8 concurrent reserve (one dense zone, distinct pallets) → executions 15, OCC retries 7, failures 7, RTT p50 265.5 ms / max 351 ms

**base: write flows**

| Flow | Function | Docs read | Docs written | Index rows | Exec p50 ms |
|---|---|---:|---:|---:|---:|
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:saveJobScans` | 10 | 4 | 22 | 32.87 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:updateJobScan` | 13 | 4 | 22 | 31.62 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:deleteJobScans` | 13 | 4 | 22 | 26.34 |
| job-scan save batch of 50 (max) | `finishedGoods/jobScans:saveJobScans` | 10 | 53 | 218 | 18.86 |
| job-scan delete batch of 50 | `finishedGoods/jobScans:saveJobScans` | 10 | 53 | 218 | 17.01 |
| job-scan delete batch of 50 | `finishedGoods/jobScans:deleteJobScans` | 160 | 53 | 218 | 36.42 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve` | 28 | 7 | 47 | 19.18 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` | 23 | 6 | 48 | 15.33 |
| pallet measurement save | `finishedGoods/workflow:saveMeasurement` | 21 | 5 | 33 | 13.3 |

**base: reactive fan-out** (60 subscriptions open on one session)

| Write | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions |
|---|---|---:|---:|---:|---:|---:|---|
| saveJobScans (1 item) | 10 / 4 / 3.7 | 2 | 122 | 64.1 | 115.3 | 0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs) |
| reserve (awaiting pallet) | 28 / 7 / 7.2 | 10 | 6098 | 3808.1 | 7027.1 | 3 (334) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/workflow:recommend×1 (2887 docs); finishedGoods/workflow:recommendMove×1 (2888 docs) |
| cancelReservation (same pallet) | 23 / 6 / 6.8 | 10 | 6096 | 3806.3 | 6294.9 | 3 (334) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/workflow:recommendMove×1 (2887 docs); finishedGoods/workflow:recommend×1 (2886 docs) |
| createPallet (busiest product) | 22 / 8 / 6.4 | 7 | 316 | 168.1 | 793.5 | 3 (334) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:page×3 (252 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs) |

**base: contention** 8 concurrent saveJobScans × 3 rounds → executions 24, OCC retries 0 (per round 0/0/0), failures 0, RTT p50 153.7 ms / max 267 ms

**base: contention** 8 concurrent createPallet (same product) × 3 rounds → executions 78, OCC retries 54 (per round 15/21/18), failures 0, RTT p50 616.7 ms / max 1991.2 ms

**base: contention** 8 concurrent createPallet (different products) × 3 rounds → executions 76, OCC retries 53 (per round 21/16/16), failures 1, RTT p50 732.9 ms / max 2300.4 ms

**base: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 20, OCC retries 12, failures 0, RTT p50 297.4 ms / max 523.9 ms

**base: contention** 8 concurrent reserve (one dense zone, distinct pallets) → executions 15, OCC retries 7, failures 7, RTT p50 316.4 ms / max 398.2 ms
