Profile `iter7-xl` · 2026-11-05T04:34:24.848Z · 7 uncached samples per target (p50) · dataset {"pallets":1305,"products":126,"zones":421,"buildings":127,"jobScans":8000,"employees":765}
Targets: candidate@78bae3d9 (convex sha256:421a7138418199aa), base@80dc0a93 (convex sha256:a486b726209f5b84) · load avg before/after 13.7/4.9

| Screen       | Function                                                        |     Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note                        |
| ------------ | --------------------------------------------------------------- | ------------: | ------: | ----------: | ---------------: | -------: | --------: | --------------------------- |
| storage      | `storageLayouts/catalogue:getStorageBuilding`                   |          1844 |  1328.2 |      176.12 |           173.05 |        1 |     453.4 | legacy (no live subscriber) |
| fg-pallet    | `finishedGoods/workflow:list`                                   |          1440 |   914.8 |      183.08 |           171.16 |        1 |     925.4 | legacy (no live subscriber) |
| storage      | `storageLayouts/catalogue:getStorageLocationMap`                |           936 |   671.6 |      110.01 |           100.98 |        1 |     376.2 | legacy (no live subscriber) |
| hr-admin     | `hr/periods:preview`                                            | 776 (was 164) |   552.0 |       64.69 |            61.82 |        1 |       0.8 |                             |
| fg-pallet    | `finishedGoods/workflow:recommendMove` (list)                   |           688 |  1284.5 |      162.44 |             0.15 |        1 |     128.0 |                             |
| fg-pallet    | `finishedGoods/workflow:recommendMove` (full payload)           |           688 |  1284.5 |      204.68 |           404.43 |        1 |     238.5 | legacy (no live subscriber) |
| fg-pallet    | `finishedGoods/workflow:recommend` (list)                       |           687 |  1283.7 |      159.64 |             0.14 |        1 |     127.7 |                             |
| fg-pallet    | `finishedGoods/workflow:recommend` (full payload)               |           687 |  1283.7 |       174.2 |           363.68 |        1 |     238.3 | legacy (no live subscriber) |
| storage      | `storageLayouts/locationCatalogue:detail`                       |           312 |   274.5 |       87.24 |            90.47 |        1 |      62.6 |                             |
| hr-admin     | `hr/roster:roster` (no page size)                               |           253 |   154.0 |        88.4 |            61.72 |        1 |     646.8 |                             |
| hr-admin     | `hr/review:queuePage`                                           |           251 |   139.2 |       83.04 |            80.56 |        2 |      10.1 |                             |
| job-scan     | `finishedGoods/jobScanLocations:options`                        |           218 |   134.8 |       29.55 |            27.72 |        1 |      13.2 |                             |
| hr-admin     | `hr/setup:employeesPage`                                        |           141 |    83.3 |       25.83 |            24.87 |        1 |      14.9 |                             |
| hr-admin     | `hr/search:adminEmployees`                                      |           111 |    74.9 |       22.37 |            20.04 |        1 |       1.5 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (products tab)                   |           110 |    55.2 |       26.35 |               22 |        1 |      74.0 |                             |
| storage      | `storageLayouts/locationCatalogue:options`                      |           109 |    69.1 |        14.4 |             14.1 |        1 |      14.5 |                             |
| hr-admin     | `hr/roster:roster`                                              |            84 |    47.8 |       38.73 |             0.13 |        1 |     131.1 |                             |
| storage      | `storageLayouts/locationCatalogue:page`                         |            83 |    52.8 |       24.08 |            21.65 |        1 |      25.8 |                             |
| fg-pallet    | `finishedGoods/workflow:getPallet`                              |            75 |    50.9 |       19.77 |            17.17 |        1 |       2.3 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans` (search)                  |   70 (was 61) |    30.2 |      639.91 |          6626.86 |        1 |       3.8 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets tab)                    |            65 |    39.2 |       38.87 |            35.23 |        1 |      75.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets search)                 |            65 |    39.2 |        40.3 |            35.36 |        1 |      75.3 |                             |
| job-scan     | `finishedGoods/jobScanLocations:buildingOptions`                |            61 |    37.8 |       14.73 |            13.86 |        1 |       7.7 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans`                           |            60 |    37.1 |      129.78 |           126.73 |        1 |      21.2 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans` (unmapped)                |            60 |    36.9 |      111.36 |           108.66 |        1 |      21.3 |                             |
| job-scan     | `finishedGoods/jobScanLocations:searchPage`                     |            39 |    15.9 |       30.24 |           135.32 |        1 |       0.2 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingInventory`          |            35 |   964.1 |       63.05 |            201.4 |        1 |     447.8 |                             |
| fg-product   | `finishedGoods/batches:pageLegacyUnits`                         |            30 |    17.4 |       19.96 |            17.92 |        1 |      15.8 |                             |
| storage      | `storageLayouts/catalogue:listStorageBuildingsPage`             |            29 |    16.2 |       12.53 |            11.07 |        1 |      13.7 |                             |
| hr-admin     | `hr/periods:versionRowsPage`                                    |            29 |    16.3 |       12.92 |            13.47 |        1 |       9.4 |                             |
| hr-admin     | `hr/setup:accessMembersPage`                                    |            26 |     8.4 |        14.7 |            12.09 |        1 |       0.6 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingLayout`             |            25 |    14.3 |       13.87 |            11.76 |        1 |       7.4 |                             |
| storage      | `storageLayouts/writes:layoutReadiness`                         |            25 |    14.3 |       16.52 |            15.94 |        1 |       1.9 |                             |
| storage      | `storageLayouts/catalogue:buildingOccupancy`                    |            21 |     8.5 |       12.38 |            93.92 |        1 |       1.0 |                             |
| hr-admin     | `hr/setup:employee`                                             |            19 |     6.2 |        12.9 |            12.11 |        1 |       0.6 |                             |
| fg-catalogue | `finishedGoods/catalogue:summary`                               |            18 |     6.9 |       11.01 |            43.02 |        1 |       0.3 |                             |
| fg-pallet    | `finishedGoods/workflow:recommendationZone` (viewed zone)       |            17 |     6.3 |        13.2 |             0.09 |        1 |       0.6 |                             |
| fg-pallet    | `finishedGoods/workflow:recommendationZone` (move: viewed zone) |            17 |     6.5 |       13.31 |              0.1 |        1 |       0.6 |                             |
| ai-usage     | `aiUsage/dimensions:actorOptions`                               |            17 |     5.3 |       12.08 |            10.61 |        1 |       0.4 |                             |
| shell        | `workspace/current:readCurrent`                                 |            16 |     5.0 |          12 |            10.49 |        1 |       0.5 |                             |
| shell        | `hr/access:display`                                             |            16 |     5.3 |       15.56 |            12.14 |        1 |       0.7 |                             |
| job-scan     | `finishedGoods/jobScanLocations:resolve`                        |            15 |     6.2 |       12.24 |            10.79 |        1 |       0.6 |                             |
| job-scan     | `finishedGoods/scanning:resolveLocationCode`                    |            13 |     5.0 |       10.98 |            10.01 |        1 |       0.5 |                             |
| hr-self      | `hr/self:today`                                                 |            13 |     5.8 |       13.11 |            12.72 |        1 |       0.8 |                             |
| fg-product   | `finishedGoods/catalogue:productSummary`                        |            12 |     4.3 |       11.41 |             9.11 |        1 |       0.3 |                             |
| hr-self      | `hr/self:profile`                                               |            12 |     4.1 |       11.81 |            10.72 |        1 |       0.6 |                             |
| hr-self      | `hr/self:history`                                               |            12 |     5.6 |        13.1 |            13.12 |        1 |       1.6 |                             |
| shell        | `aiUsage/reports:access`                                        |            11 |     3.4 |       10.08 |             8.74 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/batches:getBatch`                                |            11 |     3.7 |       11.46 |            11.14 |        1 |       1.0 |                             |
| storage      | `storageLayouts/catalogue:buildingStatusControl`                |            11 |     4.4 |       10.62 |                9 |        1 |       0.1 |                             |
| hr-admin     | `hr/leave:queuePage`                                            |            11 |     3.4 |       10.94 |             9.66 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/workflow:getProduct`                             |            10 |     3.4 |        10.4 |             9.66 |        1 |       0.7 |                             |
| fg-pallet    | `finishedGoods/history:palletMoveHistory`                       |            10 |     3.4 |       11.57 |            10.64 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/workflow:stackChoices`                           |            10 |     3.4 |       11.32 |            10.49 |        1 |       0.1 |                             |
| job-scan     | `finishedGoods/scanning:resolvePackageCode`                     |            10 |     3.5 |       10.85 |             9.16 |        1 |       0.1 | NOT_OK                      |
| hr-self      | `hr/self:requests`                                              |            10 |     4.3 |       10.94 |            10.25 |        1 |       0.6 |                             |
| hr-admin     | `hr/periods:listPage`                                           |            10 |     3.4 |       10.73 |             9.88 |        1 |       0.5 |                             |
| fg-product   | `finishedGoods/batches:pageProductBatches`                      |             9 |     2.9 |       11.74 |            10.48 |        1 |       0.1 |                             |
| job-scan     | `finishedGoods/jobScanLocations:page`                           |             9 |     2.9 |       12.04 |             9.43 |        1 |       0.2 |                             |
| hr-self      | `hr/announcements:self`                                         |             9 |     3.4 |       11.38 |             10.7 |        1 |       0.1 |                             |
| hr-self      | `hr/notifications:list`                                         |             9 |     3.4 |       11.18 |            10.78 |        1 |       0.2 |                             |
| hr-self      | `hr/leave:self`                                                 |             9 |     3.4 |       12.03 |            11.72 |        1 |       0.3 |                             |
| hr-admin     | `hr/roster:shifts`                                              |             9 |     2.8 |       10.47 |             9.91 |        1 |       0.2 |                             |
| hr-admin     | `hr/payslips:list`                                              |             9 |     3.4 |       10.54 |            10.29 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/payslips:imports`                                           |             8 |     2.7 |       10.49 |             9.23 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/org:listDepartments`                                        |             8 |     2.7 |       10.31 |             9.11 |        1 |       0.1 |                             |
| ai-usage     | `aiUsage/reports:summary`                                       |             8 |     2.7 |       11.78 |            10.25 |        1 |       1.2 |                             |
| ai-usage     | `aiUsage/reports:recent`                                        |             8 |     2.7 |       11.79 |            10.38 |        1 |       0.1 |                             |

**candidate: write flows**

| Flow                                      | Function                                   | Docs read | Docs written | Index rows | Exec p50 ms |
| ----------------------------------------- | ------------------------------------------ | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:saveJobScans`      |        18 |           28 |        123 |       17.15 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:updateJobScan`     |        89 |           31 |        139 |       18.86 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:deleteJobScans`    |        73 |           24 |        109 |       15.25 |
| job-scan save batch of 50 (max)           | `finishedGoods/jobScans:saveJobScans`      |       263 |         1252 |       5264 |      141.89 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve`           |        37 |            9 |         58 |       16.54 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` |        32 |            8 |         59 |       16.48 |
| pallet measurement save                   | `finishedGoods/workflow:saveMeasurement`   |        20 |            5 |         33 |       16.08 |

**candidate: reactive fan-out** (62 subscriptions open on one session)

| Write                           | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions                                                                                                                                                                                                                                    |
| ------------------------------- | -------------------------------------------------- | -------------: | -----------: | ---------: | -------------: | -------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| saveJobScans (1 item)           | 18 / 18 / 12.9                                     |              3 |          194 |       95.1 |            209 |                            0 (0) | finishedGoods/jobScans:listJobScans×3 (194 docs)                                                                                                                                                                                                    |
| reserve (awaiting pallet)       | 40 / 9 / 9.7                                       |              7 |         1570 |     2674.8 |          603.4 |                            0 (0) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/workflow:recommendationZone×2 (36 docs); finishedGoods/catalogue:page×2 (147 docs); finishedGoods/workflow:recommendMove×1 (689 docs); finishedGoods/workflow:recommend×1 (688 docs) |
| cancelReservation (same pallet) | 35 / 8 / 8.3                                       |              7 |         1570 |     2670.8 |          602.6 |                            0 (0) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/workflow:recommendationZone×2 (36 docs); finishedGoods/catalogue:page×2 (147 docs); finishedGoods/workflow:recommend×1 (688 docs); finishedGoods/workflow:recommendMove×1 (689 docs) |
| createPallet (busiest product)  | 28 / 9 / 6.9                                       |              6 |          320 |      170.4 |          257.9 |                            0 (0) | finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/catalogue:summary×1 (18 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (259 docs)                                                       |

**candidate: contention** 8 concurrent saveJobScans × 3 rounds → executions 24, OCC retries 0 (per round 0/0/0), failures 0, RTT p50 133.2 ms / max 217 ms

**candidate: contention** 8 concurrent createPallet (same product) × 3 rounds → executions 62, OCC retries 38 (per round 15/12/11), failures 0, RTT p50 164.3 ms / max 964 ms

**candidate: contention** 8 concurrent createPallet (different products) × 3 rounds → executions 61, OCC retries 37 (per round 13/11/13), failures 0, RTT p50 196.1 ms / max 541.3 ms

**candidate: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 11, OCC retries 3, failures 0, RTT p50 58 ms / max 100.3 ms

**base: write flows**

| Flow                                      | Function                                   | Docs read | Docs written | Index rows | Exec p50 ms |
| ----------------------------------------- | ------------------------------------------ | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:saveJobScans`      |        10 |            4 |         22 |       11.38 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:updateJobScan`     |        13 |            4 |         22 |       12.19 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:deleteJobScans`    |        13 |            4 |         22 |       11.58 |
| job-scan save batch of 50 (max)           | `finishedGoods/jobScans:saveJobScans`      |        10 |           53 |        218 |       17.22 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve`           |        28 |            7 |         47 |       14.06 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` |        23 |            6 |         48 |       13.47 |
| pallet measurement save                   | `finishedGoods/workflow:saveMeasurement`   |        21 |            5 |         33 |       12.54 |

**base: reactive fan-out** (60 subscriptions open on one session)

| Write                           | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------- | -------------: | -----------: | ---------: | -------------: | -------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| saveJobScans (1 item)           | 10 / 4 / 3.7                                       |              2 |          122 |       64.1 |           53.6 |                            0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs)                                                                                                                                                                                                                                                                                                                                                         |
| reserve (awaiting pallet)       | 28 / 7 / 7.2                                       |             10 |         6098 |     3808.1 |         1514.5 |                          3 (334) | finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/workflow:recommendMove×1 (2888 docs); finishedGoods/workflow:recommend×1 (2887 docs) |
| cancelReservation (same pallet) | 23 / 6 / 6.8                                       |             10 |         6096 |     3806.3 |         1333.6 |                          3 (334) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/workflow:recommendMove×1 (2887 docs); finishedGoods/workflow:recommend×1 (2886 docs) |
| createPallet (busiest product)  | 22 / 8 / 6.4                                       |              7 |          316 |      168.1 |          240.5 |                          3 (334) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (252 docs)                                                                                                                                                      |

**base: contention** 8 concurrent saveJobScans × 3 rounds → executions 24, OCC retries 0 (per round 0/0/0), failures 0, RTT p50 56.6 ms / max 87.8 ms

**base: contention** 8 concurrent createPallet (same product) × 3 rounds → executions 62, OCC retries 38 (per round 14/13/11), failures 0, RTT p50 233.7 ms / max 711.6 ms

**base: contention** 8 concurrent createPallet (different products) × 3 rounds → executions 60, OCC retries 36 (per round 14/11/11), failures 0, RTT p50 179.1 ms / max 598.5 ms

**base: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 23, OCC retries 15, failures 0, RTT p50 208.9 ms / max 625.2 ms
