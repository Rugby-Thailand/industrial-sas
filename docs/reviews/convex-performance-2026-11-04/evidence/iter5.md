Profile `iter5` · 2026-11-04T16:52:22.076Z · 7 uncached samples per target (p50) · dataset {"pallets":1305,"products":126,"zones":421,"buildings":127,"jobScans":2182,"employees":153}
Targets: candidate@db92906a+dirty (convex sha256:be40ad7cfa789fc2), base@80dc0a93 (convex sha256:a486b726209f5b84) · load avg before/after 28.8/46.1

| Screen       | Function                                               |      Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note                        |
| ------------ | ------------------------------------------------------ | -------------: | ------: | ----------: | ---------------: | -------: | --------: | --------------------------- |
| job-scan     | `finishedGoods/jobScans:listJobScans` (search)         |           2389 |  1541.1 |      565.36 |           554.88 |       22 |      21.5 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuilding`          |           1844 |  1328.2 |      185.92 |           182.35 |        1 |     453.4 | legacy (no live subscriber) |
| fg-pallet    | `finishedGoods/workflow:list`                          |           1440 |   914.8 |      177.95 |           179.29 |        1 |     925.4 | legacy (no live subscriber) |
| storage      | `storageLayouts/catalogue:getStorageLocationMap`       |            936 |   671.6 |      116.95 |           107.73 |        1 |     376.2 | legacy (no live subscriber) |
| job-scan     | `finishedGoods/jobScanLocations:searchPage`            |            896 |   474.3 |      141.55 |           142.32 |        2 |       0.8 |                             |
| fg-pallet    | `finishedGoods/workflow:recommendMove`                 | 688 (was 2887) |  1284.5 |      296.28 |           674.33 |        1 |     238.5 |                             |
| fg-pallet    | `finishedGoods/workflow:recommend`                     | 687 (was 2886) |  1283.7 |       157.2 |            353.3 |        1 |     238.3 |                             |
| storage      | `storageLayouts/locationCatalogue:detail`              |            312 |   274.5 |      104.83 |            92.75 |        1 |      62.6 |                             |
| hr-admin     | `hr/review:queuePage`                                  |            251 |   139.4 |       85.22 |            88.39 |        2 |       9.9 |                             |
| job-scan     | `finishedGoods/jobScanLocations:options`               |            218 |   134.8 |       28.26 |             27.9 |        1 |      13.2 |                             |
| hr-admin     | `hr/periods:preview`                                   |            164 |   114.0 |       17.86 |            18.34 |        1 |       0.8 |                             |
| hr-admin     | `hr/roster:roster`                                     |            162 |   112.8 |       20.97 |            20.94 |        1 |       0.1 | LIMIT_EXCEEDED              |
| hr-admin     | `hr/setup:employeesPage`                               |            141 |    83.6 |       24.06 |            25.27 |        1 |      15.0 |                             |
| hr-admin     | `hr/search:adminEmployees`                             |            111 |    75.2 |          20 |            19.88 |        1 |       1.5 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (products tab)          |            110 |    55.2 |        22.9 |            22.44 |        1 |      74.0 |                             |
| storage      | `storageLayouts/locationCatalogue:options`             |            109 |    69.1 |       14.69 |            14.35 |        1 |      14.5 |                             |
| storage      | `storageLayouts/locationCatalogue:page`                |             83 |    52.8 |       22.08 |            22.27 |        1 |      25.8 |                             |
| fg-pallet    | `finishedGoods/workflow:getPallet`                     |             75 |    50.9 |       17.94 |             17.1 |        1 |       2.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets tab)           |             65 |    39.2 |       62.01 |            60.09 |        1 |      75.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets search)        |             65 |    39.2 |       61.84 |            67.31 |        1 |      75.3 |                             |
| job-scan     | `finishedGoods/jobScanLocations:buildingOptions`       |             61 |    37.8 |       13.78 |            13.32 |        1 |       7.7 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans`                  |             60 |    36.9 |        32.6 |            32.23 |        1 |      21.3 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans` (unmapped)       |             60 |    37.0 |       32.32 |            30.85 |        1 |      21.3 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingInventory` |  35 (was 1829) |   964.1 |      262.89 |          1526.17 |        1 |     447.8 |                             |
| fg-product   | `finishedGoods/batches:pageLegacyUnits`                |             31 |    17.8 |       19.21 |            18.77 |        1 |      15.8 |                             |
| storage      | `storageLayouts/catalogue:listStorageBuildingsPage`    |             29 |    16.2 |       12.01 |            11.75 |        1 |      13.7 |                             |
| hr-admin     | `hr/periods:versionRowsPage`                           |             29 |    16.3 |       12.04 |            11.91 |        1 |       9.4 |                             |
| hr-admin     | `hr/setup:accessMembersPage`                           |             26 |     8.4 |       24.82 |             23.4 |        1 |       0.6 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingLayout`    |             25 |    14.3 |       85.21 |            60.71 |        1 |       7.4 |                             |
| storage      | `storageLayouts/writes:layoutReadiness`                |             25 |    14.3 |       15.67 |            15.12 |        1 |       1.9 |                             |
| storage      | `storageLayouts/catalogue:buildingOccupancy`           |   21 (was 917) |     8.5 |       12.07 |           112.78 |        1 |       1.0 |                             |
| hr-admin     | `hr/setup:employee`                                    |             19 |     6.2 |       13.52 |             12.6 |        1 |       0.6 |                             |
| fg-catalogue | `finishedGoods/catalogue:summary`                      |   18 (was 272) |     6.9 |       10.01 |            49.21 |        1 |       0.3 |                             |
| ai-usage     | `aiUsage/dimensions:actorOptions`                      |             17 |     5.3 |       11.38 |            11.91 |        1 |       0.4 |                             |
| shell        | `workspace/current:readCurrent`                        |             16 |     5.0 |       11.38 |            10.83 |        1 |       0.5 |                             |
| shell        | `hr/access:display`                                    |             16 |     5.3 |       11.93 |            11.59 |        1 |       0.7 |                             |
| job-scan     | `finishedGoods/jobScanLocations:resolve`               |             15 |     6.2 |       12.44 |            12.02 |        1 |       0.6 |                             |
| hr-self      | `hr/self:today`                                        |             14 |     6.3 |       13.57 |            14.25 |        1 |       0.8 |                             |
| job-scan     | `finishedGoods/scanning:resolveLocationCode`           |             13 |     5.0 |       11.02 |            10.56 |        1 |       0.5 |                             |
| fg-product   | `finishedGoods/catalogue:productSummary`               |             12 |     4.3 |        10.5 |            10.14 |        1 |       0.3 |                             |
| hr-self      | `hr/self:profile`                                      |             12 |     4.1 |       12.24 |            11.79 |        1 |       0.6 |                             |
| hr-self      | `hr/self:history`                                      |             12 |     5.6 |          14 |            12.43 |        1 |       1.6 |                             |
| shell        | `aiUsage/reports:access`                               |             11 |     3.4 |       10.13 |             9.66 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/batches:getBatch`                       |             11 |     3.7 |       10.98 |            11.04 |        1 |       1.0 |                             |
| storage      | `storageLayouts/catalogue:buildingStatusControl`       |             11 |     4.4 |       11.08 |            10.69 |        1 |       0.1 |                             |
| hr-admin     | `hr/leave:queuePage`                                   |             11 |     3.4 |       19.44 |             21.6 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/workflow:getProduct`                    |             10 |     3.4 |       10.26 |             9.82 |        1 |       0.7 |                             |
| fg-product   | `finishedGoods/batches:pageProductBatches`             |             10 |     3.3 |       11.29 |               11 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/history:palletMoveHistory`              |             10 |     3.4 |        10.1 |             9.95 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/workflow:stackChoices`                  |             10 |     3.4 |       17.79 |            30.65 |        1 |       0.1 |                             |
| job-scan     | `finishedGoods/scanning:resolvePackageCode`            |             10 |     3.5 |        9.89 |              9.3 |        1 |       0.1 | NOT_OK                      |
| hr-self      | `hr/self:requests`                                     |             10 |     4.3 |        10.4 |            11.59 |        1 |       0.6 |                             |
| hr-admin     | `hr/periods:listPage`                                  |             10 |     3.4 |       10.47 |               11 |        1 |       0.5 |                             |
| job-scan     | `finishedGoods/jobScanLocations:page`                  |              9 |     2.9 |       10.89 |            10.81 |        1 |       0.2 |                             |
| hr-self      | `hr/announcements:self`                                |              9 |     3.4 |       10.69 |             10.6 |        1 |       0.1 |                             |
| hr-self      | `hr/notifications:list`                                |              9 |     3.4 |       11.17 |             11.9 |        1 |       0.2 |                             |
| hr-self      | `hr/leave:self`                                        |              9 |     3.4 |       12.13 |            12.97 |        1 |       0.3 |                             |
| hr-admin     | `hr/roster:shifts`                                     |              9 |     2.8 |       10.11 |             10.1 |        1 |       0.2 |                             |
| hr-admin     | `hr/payslips:list`                                     |              9 |     3.4 |       11.75 |            11.19 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/payslips:imports`                                  |              8 |     2.7 |       12.75 |            12.48 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/org:listDepartments`                               |              8 |     2.7 |       11.32 |            15.52 |        1 |       0.1 |                             |
| ai-usage     | `aiUsage/reports:summary`                              |              8 |     2.7 |       11.11 |            12.07 |        1 |       1.2 |                             |
| ai-usage     | `aiUsage/reports:recent`                               |              8 |     2.7 |       10.82 |            11.03 |        1 |       0.1 |                             |

**candidate: write flows**

| Flow                                      | Function                                   | Docs read | Docs written | Index rows | Exec p50 ms |
| ----------------------------------------- | ------------------------------------------ | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:saveJobScans`      |        10 |            4 |         22 |       13.56 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:updateJobScan`     |        13 |            4 |         22 |       12.86 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:deleteJobScans`    |        13 |            4 |         22 |       12.07 |
| job-scan save batch of 50 (max)           | `finishedGoods/jobScans:saveJobScans`      |        10 |           53 |        218 |       26.27 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve`           |        37 |            9 |         56 |       21.04 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` |        32 |            8 |         57 |       16.08 |
| pallet measurement save                   | `finishedGoods/workflow:saveMeasurement`   |        23 |            5 |         33 |       14.37 |

**candidate: reactive fan-out** (60 subscriptions open on one session)

| Write                           | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions                                                                                                                                                                                                                                                                                      |
| ------------------------------- | -------------------------------------------------- | -------------: | -----------: | ---------: | -------------: | -------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| saveJobScans (1 item)           | 10 / 4 / 3.7                                       |              2 |          122 |       64.1 |           93.6 |                            0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs)                                                                                                                                                                                                                                                      |
| reserve (awaiting pallet)       | 40 / 9 / 9.4                                       |              8 |         1718 |     2745.3 |          769.4 |                            0 (0) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (18 docs); finishedGoods/batches:pageLegacyUnits×1 (39 docs); finishedGoods/catalogue:page×3 (274 docs); finishedGoods/workflow:recommend×1 (688 docs); finishedGoods/workflow:recommendMove×1 (689 docs) |
| cancelReservation (same pallet) | 35 / 8 / 8.1                                       |              8 |         1718 |     2743.2 |          747.1 |                            0 (0) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (18 docs); finishedGoods/batches:pageLegacyUnits×1 (39 docs); finishedGoods/catalogue:page×3 (274 docs); finishedGoods/workflow:recommend×1 (688 docs); finishedGoods/workflow:recommendMove×1 (689 docs) |
| createPallet (busiest product)  | 27 / 9 / 6.9                                       |              7 |          364 |      183.7 |          224.5 |                            0 (0) | finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/catalogue:summary×1 (18 docs); finishedGoods/batches:pageProductBatches×1 (18 docs); finishedGoods/batches:pageLegacyUnits×1 (40 docs); finishedGoods/catalogue:page×3 (276 docs)                                                   |

**candidate: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 137.6 ms / max 146.2 ms

**candidate: contention** 8 concurrent createPallet (same product) → executions 25, OCC retries 17, failures 0, RTT p50 455.8 ms / max 874.5 ms

**candidate: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 12, OCC retries 4, failures 0, RTT p50 125.3 ms / max 287.1 ms

**base: write flows**

| Flow                                      | Function                                   | Docs read | Docs written | Index rows | Exec p50 ms |
| ----------------------------------------- | ------------------------------------------ | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:saveJobScans`      |        10 |            4 |         22 |        37.8 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:updateJobScan`     |        13 |            4 |         22 |       40.36 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:deleteJobScans`    |        13 |            4 |         22 |       54.05 |
| job-scan save batch of 50 (max)           | `finishedGoods/jobScans:saveJobScans`      |        10 |           53 |        218 |       57.25 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve`           |        28 |            7 |         47 |        46.6 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` |        23 |            6 |         48 |       21.33 |
| pallet measurement save                   | `finishedGoods/workflow:saveMeasurement`   |        21 |            5 |         33 |       24.82 |

**base: reactive fan-out** (60 subscriptions open on one session)

| Write                           | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------- | -------------: | -----------: | ---------: | -------------: | -------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| saveJobScans (1 item)           | 10 / 4 / 3.7                                       |              2 |          122 |       64.1 |           64.7 |                            0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs)                                                                                                                                                                                                                                                                                                                                                         |
| reserve (awaiting pallet)       | 28 / 7 / 7.2                                       |             10 |         6098 |     3808.1 |         4179.6 |                          2 (272) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/workflow:recommendMove×1 (2888 docs); finishedGoods/workflow:recommend×1 (2887 docs) |
| cancelReservation (same pallet) | 23 / 6 / 6.8                                       |             10 |         6096 |     3806.3 |         7510.1 |                          2 (272) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/workflow:recommend×1 (2886 docs); finishedGoods/workflow:recommendMove×1 (2887 docs) |
| createPallet (busiest product)  | 22 / 8 / 6.4                                       |              7 |          316 |      168.1 |          733.3 |                          2 (272) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:page×3 (252 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs)                                                                                                                                                      |

**base: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 134.7 ms / max 167.9 ms

**base: contention** 8 concurrent createPallet (same product) → executions 22, OCC retries 14, failures 0, RTT p50 479.8 ms / max 851.5 ms

**base: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 25, OCC retries 17, failures 0, RTT p50 456.8 ms / max 1447.2 ms
