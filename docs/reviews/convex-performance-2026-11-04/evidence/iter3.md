Profile `iter3` · 2026-11-04T16:04:14.232Z · 7 uncached samples per target (p50) · dataset {"pallets":1305,"products":126,"zones":421,"buildings":127,"jobScans":2182,"employees":153}
Targets: candidate@d84cb789+dirty (convex sha256:8c112d95e35b8cc6), base@80dc0a93 (convex sha256:a486b726209f5b84) · load avg before/after 6.6/7.5

| Screen       | Function                                               |      Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note                        |
| ------------ | ------------------------------------------------------ | -------------: | ------: | ----------: | ---------------: | -------: | --------: | --------------------------- |
| job-scan     | `finishedGoods/jobScans:listJobScans` (search)         |           2389 |  1541.1 |      483.66 |           496.35 |       22 |      21.5 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuilding`          |           1844 |  1328.2 |      161.94 |           169.21 |        1 |     453.4 | legacy (no live subscriber) |
| fg-pallet    | `finishedGoods/workflow:list`                          |           1440 |   914.8 |      159.17 |           158.21 |        1 |     925.4 | legacy (no live subscriber) |
| storage      | `storageLayouts/catalogue:getStorageLocationMap`       |            936 |   671.6 |       94.91 |            96.29 |        1 |     376.2 | legacy (no live subscriber) |
| job-scan     | `finishedGoods/jobScanLocations:searchPage`            |            896 |   474.3 |      123.83 |           126.02 |        2 |       0.8 |                             |
| fg-pallet    | `finishedGoods/workflow:recommendMove`                 | 688 (was 2887) |  1284.4 |      141.36 |           310.06 |        1 |     238.5 |                             |
| fg-pallet    | `finishedGoods/workflow:recommend`                     | 687 (was 2886) |  1283.7 |      140.49 |           307.26 |        1 |     238.3 |                             |
| storage      | `storageLayouts/locationCatalogue:detail`              |            312 |   274.5 |       81.39 |            76.47 |        1 |      62.6 |                             |
| fg-catalogue | `finishedGoods/catalogue:summary`                      |            272 |   136.9 |       41.09 |             38.3 |        2 |       1.6 |                             |
| hr-admin     | `hr/review:queuePage`                                  |            251 |   139.4 |       54.01 |            57.21 |        2 |       9.9 |                             |
| job-scan     | `finishedGoods/jobScanLocations:options`               |            218 |   134.8 |       25.68 |            25.69 |        1 |      13.2 |                             |
| hr-admin     | `hr/periods:preview`                                   |            164 |   114.0 |        15.8 |            16.71 |        1 |       0.8 |                             |
| hr-admin     | `hr/roster:roster`                                     |            162 |   112.8 |        15.3 |            15.91 |        1 |       0.1 | LIMIT_EXCEEDED              |
| hr-admin     | `hr/setup:employeesPage`                               |            141 |    83.6 |       16.82 |            16.98 |        1 |      15.0 |                             |
| hr-admin     | `hr/search:adminEmployees`                             |            111 |    75.2 |       14.59 |            14.33 |        1 |       1.5 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (products tab)          |            110 |    55.1 |        21.5 |            20.66 |        1 |      74.0 |                             |
| storage      | `storageLayouts/locationCatalogue:options`             |            109 |    69.1 |       11.38 |            11.09 |        1 |      14.5 |                             |
| storage      | `storageLayouts/locationCatalogue:page`                |             83 |    52.8 |       17.57 |            17.74 |        1 |      25.8 |                             |
| fg-pallet    | `finishedGoods/workflow:getPallet`                     |             75 |    50.9 |       14.83 |            16.76 |        1 |       2.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets tab)           |             65 |    39.2 |       33.39 |            33.38 |        1 |      75.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets search)        |             65 |    39.2 |       34.16 |             33.2 |        1 |      75.3 |                             |
| job-scan     | `finishedGoods/jobScanLocations:buildingOptions`       |             61 |    37.8 |       12.41 |            13.55 |        1 |       7.7 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans`                  |             60 |    36.9 |       29.33 |            30.75 |        1 |      21.3 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans` (unmapped)       |             60 |    37.0 |       29.11 |            28.54 |        1 |      21.3 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingInventory` |  35 (was 1829) |   964.0 |       53.65 |           187.26 |        1 |     447.8 |                             |
| fg-product   | `finishedGoods/batches:pageLegacyUnits`                |             31 |    17.7 |        16.1 |            15.59 |        1 |      15.8 |                             |
| storage      | `storageLayouts/catalogue:listStorageBuildingsPage`    |             29 |    16.2 |       10.73 |            11.42 |        1 |      13.7 |                             |
| hr-admin     | `hr/periods:versionRowsPage`                           |             29 |    16.3 |       10.61 |            10.54 |        1 |       9.4 |                             |
| hr-admin     | `hr/setup:accessMembersPage`                           |             26 |     8.4 |       11.97 |            12.66 |        1 |       0.6 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingLayout`    |             25 |    14.3 |       12.29 |            14.38 |        1 |       7.4 |                             |
| storage      | `storageLayouts/writes:layoutReadiness`                |             25 |    14.3 |        11.4 |            12.31 |        1 |       1.9 |                             |
| storage      | `storageLayouts/catalogue:buildingOccupancy`           |   21 (was 917) |     8.4 |        9.93 |            89.49 |        1 |       1.0 |                             |
| hr-admin     | `hr/setup:employee`                                    |             19 |     6.2 |       10.66 |            10.32 |        1 |       0.6 |                             |
| ai-usage     | `aiUsage/dimensions:actorOptions`                      |             17 |     5.3 |       10.29 |            10.03 |        1 |       0.4 |                             |
| shell        | `workspace/current:readCurrent`                        |             16 |     5.0 |         9.1 |              8.2 |        1 |       0.5 |                             |
| shell        | `hr/access:display`                                    |             16 |     5.3 |       11.63 |            10.37 |        1 |       0.7 |                             |
| job-scan     | `finishedGoods/jobScanLocations:resolve`               |             15 |     6.2 |       10.97 |            11.83 |        1 |       0.6 |                             |
| hr-self      | `hr/self:today`                                        |             14 |     6.3 |       10.21 |            11.37 |        1 |       0.8 |                             |
| job-scan     | `finishedGoods/scanning:resolveLocationCode`           |             13 |     5.0 |        9.27 |            11.43 |        1 |       0.5 |                             |
| fg-product   | `finishedGoods/catalogue:productSummary`               |             12 |     4.3 |        8.95 |              8.8 |        1 |       0.3 |                             |
| hr-self      | `hr/self:profile`                                      |             12 |     4.1 |        9.89 |             9.57 |        1 |       0.6 |                             |
| hr-self      | `hr/self:history`                                      |             12 |     5.6 |       11.57 |            12.36 |        1 |       1.6 |                             |
| shell        | `aiUsage/reports:access`                               |             11 |     3.4 |        9.61 |             8.64 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/batches:getBatch`                       |             11 |     3.7 |         8.9 |             9.01 |        1 |       1.0 |                             |
| storage      | `storageLayouts/catalogue:buildingStatusControl`       |             11 |     4.4 |        9.81 |             11.5 |        1 |       0.1 |                             |
| hr-admin     | `hr/leave:queuePage`                                   |             11 |     3.4 |        9.17 |             9.06 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/workflow:getProduct`                    |             10 |     3.4 |        9.74 |             9.66 |        1 |       0.7 |                             |
| fg-product   | `finishedGoods/batches:pageProductBatches`             |             10 |     3.2 |        9.46 |             9.93 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/history:palletMoveHistory`              |             10 |     3.4 |        9.26 |             8.85 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/workflow:stackChoices`                  |             10 |     3.4 |        8.99 |             9.84 |        1 |       0.1 |                             |
| job-scan     | `finishedGoods/scanning:resolvePackageCode`            |             10 |     3.5 |        8.28 |             9.95 |        1 |       0.1 | NOT_OK                      |
| hr-self      | `hr/self:requests`                                     |             10 |     4.3 |        9.27 |             9.44 |        1 |       0.6 |                             |
| hr-admin     | `hr/periods:listPage`                                  |             10 |     3.4 |        8.44 |             9.04 |        1 |       0.5 |                             |
| job-scan     | `finishedGoods/jobScanLocations:page`                  |              9 |     2.9 |       10.28 |            10.53 |        1 |       0.2 |                             |
| hr-self      | `hr/announcements:self`                                |              9 |     3.4 |       10.02 |            11.77 |        1 |       0.1 |                             |
| hr-self      | `hr/notifications:list`                                |              9 |     3.4 |        9.29 |            10.38 |        1 |       0.2 |                             |
| hr-self      | `hr/leave:self`                                        |              9 |     3.4 |        9.81 |            10.01 |        1 |       0.3 |                             |
| hr-admin     | `hr/roster:shifts`                                     |              9 |     2.8 |        9.98 |            10.36 |        1 |       0.2 |                             |
| hr-admin     | `hr/payslips:list`                                     |              9 |     3.4 |        10.3 |             9.34 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/payslips:imports`                                  |              8 |     2.7 |        9.46 |             8.74 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/org:listDepartments`                               |              8 |     2.7 |        9.62 |             9.29 |        1 |       0.1 |                             |
| ai-usage     | `aiUsage/reports:summary`                              |              8 |     2.7 |        9.04 |             8.77 |        1 |       1.2 |                             |
| ai-usage     | `aiUsage/reports:recent`                               |              8 |     2.7 |        9.45 |             8.89 |        1 |       0.1 |                             |

**candidate: write flows**

| Flow                                      | Function                                   | Docs read | Docs written | Index rows | Exec p50 ms |
| ----------------------------------------- | ------------------------------------------ | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:saveJobScans`      |        10 |            4 |         22 |       10.87 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:updateJobScan`     |        13 |            4 |         22 |       10.35 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:deleteJobScans`    |        13 |            4 |         22 |       10.72 |
| job-scan save batch of 50 (max)           | `finishedGoods/jobScans:saveJobScans`      |        10 |           53 |        218 |       14.54 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve`           |        37 |            9 |         56 |       16.12 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` |        32 |            8 |         57 |       13.17 |
| pallet measurement save                   | `finishedGoods/workflow:saveMeasurement`   |        20 |            5 |         33 |       16.76 |

**candidate: reactive fan-out** (60 subscriptions open on one session)

| Write                           | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------- | -------------: | -----------: | ---------: | -------------: | -------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| saveJobScans (1 item)           | 10 / 4 / 3.7                                       |              2 |          122 |       64.1 |           31.3 |                            0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs)                                                                                                                                                                                                                                                                                                                                                       |
| reserve (awaiting pallet)       | 37 / 9 / 9.4                                       |             10 |         1707 |     2742.5 |          801.7 |                          2 (274) | finishedGoods/catalogue:summary×1 (11 docs); finishedGoods/batches:pageProductBatches×1 (11 docs); finishedGoods/catalogue:productSummary×1 (13 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (253 docs); finishedGoods/workflow:recommend×1 (688 docs); finishedGoods/workflow:recommendMove×1 (689 docs) |
| cancelReservation (same pallet) | 32 / 8 / 8.0                                       |             10 |         1707 |     2740.4 |          754.8 |                          2 (274) | finishedGoods/catalogue:summary×1 (11 docs); finishedGoods/batches:pageProductBatches×1 (11 docs); finishedGoods/catalogue:productSummary×1 (13 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (253 docs); finishedGoods/workflow:recommend×1 (688 docs); finishedGoods/workflow:recommendMove×1 (689 docs) |
| createPallet (busiest product)  | 21 / 8 / 6.3                                       |              7 |          323 |      169.8 |          215.4 |                          2 (274) | finishedGoods/catalogue:summary×1 (11 docs); finishedGoods/catalogue:productSummary×1 (13 docs); finishedGoods/batches:pageProductBatches×1 (11 docs); finishedGoods/batches:pageLegacyUnits×1 (33 docs); finishedGoods/catalogue:page×3 (255 docs)                                                                                                                                                    |

**candidate: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 33.7 ms / max 43.2 ms

**candidate: contention** 8 concurrent createPallet (same product) → executions 21, OCC retries 13, failures 0, RTT p50 243.5 ms / max 509.6 ms

**candidate: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 8, OCC retries 0, failures 0, RTT p50 64.2 ms / max 79.7 ms

**base: write flows**

| Flow                                      | Function                                   | Docs read | Docs written | Index rows | Exec p50 ms |
| ----------------------------------------- | ------------------------------------------ | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:saveJobScans`      |        10 |            4 |         22 |        9.97 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:updateJobScan`     |        13 |            4 |         22 |       10.33 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:deleteJobScans`    |        13 |            4 |         22 |       11.49 |
| job-scan save batch of 50 (max)           | `finishedGoods/jobScans:saveJobScans`      |        10 |           53 |        218 |       14.96 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve`           |        28 |            7 |         47 |       12.38 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` |        23 |            6 |         48 |       11.13 |
| pallet measurement save                   | `finishedGoods/workflow:saveMeasurement`   |        21 |            5 |         33 |       10.74 |

**base: reactive fan-out** (60 subscriptions open on one session)

| Write                           | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------- | -------------: | -----------: | ---------: | -------------: | -------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| saveJobScans (1 item)           | 10 / 4 / 3.7                                       |              2 |          122 |       64.1 |           29.5 |                            0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs)                                                                                                                                                                                                                                                                                                                                                         |
| reserve (awaiting pallet)       | 28 / 7 / 7.2                                       |             10 |         6098 |     3808.1 |           1695 |                          2 (272) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/workflow:recommend×1 (2887 docs); finishedGoods/workflow:recommendMove×1 (2888 docs) |
| cancelReservation (same pallet) | 23 / 6 / 6.8                                       |             10 |         6096 |     3806.3 |         1208.4 |                          2 (272) | finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/workflow:recommend×1 (2886 docs); finishedGoods/workflow:recommendMove×1 (2887 docs) |
| createPallet (busiest product)  | 22 / 8 / 6.4                                       |              7 |          316 |      168.1 |          202.7 |                          2 (272) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (252 docs)                                                                                                                                                      |

**base: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 53.6 ms / max 64.1 ms

**base: contention** 8 concurrent createPallet (same product) → executions 21, OCC retries 13, failures 0, RTT p50 211.5 ms / max 537.4 ms

**base: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 22, OCC retries 14, failures 0, RTT p50 275.7 ms / max 731.7 ms
