Profile `iter0-baseline` · 2026-11-04T12:50:52.664Z · 7 uncached samples per target (p50) · dataset {"pallets":1305,"products":126,"zones":421,"buildings":127,"jobScans":2182,"employees":153}
Targets: candidate@80dc0a93, base@80dc0a93 · load avg before/after 12.7/195.3

| Screen       | Function                                               | Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note              |
| ------------ | ------------------------------------------------------ | --------: | ------: | ----------: | ---------------: | -------: | --------: | ----------------- |
| fg-pallet    | `finishedGoods/workflow:recommendMove`                 |      2887 |  1818.6 |      357.49 |           355.46 |        1 |     238.5 |                   |
| fg-pallet    | `finishedGoods/workflow:recommend`                     |      2886 |  1817.9 |      334.28 |           332.46 |        1 |     238.3 |                   |
| job-scan     | `finishedGoods/jobScans:listJobScans` (search)         |      2389 |  1541.1 |      497.11 |           499.85 |       22 |      21.5 |                   |
| storage      | `storageLayouts/catalogue:getStorageBuilding`          |      1844 |  1328.2 |      330.68 |           266.27 |        1 |     453.4 |                   |
| storage      | `storageLayouts/catalogue:getStorageBuildingInventory` |      1829 |  1317.4 |      204.34 |           203.68 |        1 |     447.8 |                   |
| fg-pallet    | `finishedGoods/workflow:list`                          |      1440 |   914.8 |      157.18 |           158.84 |        1 |     925.4 |                   |
| storage      | `storageLayouts/catalogue:getStorageLocationMap`       |       936 |   671.6 |      100.06 |           108.09 |        1 |     376.2 |                   |
| storage      | `storageLayouts/catalogue:buildingOccupancy`           |       917 |   819.4 |       91.91 |            94.82 |        1 |       1.0 |                   |
| job-scan     | `finishedGoods/jobScanLocations:searchPage`            |       896 |   474.3 |      128.54 |           131.69 |        2 |       0.8 |                   |
| storage      | `storageLayouts/locationCatalogue:detail`              |       312 |   274.5 |       84.96 |            86.23 |        1 |      62.6 |                   |
| fg-catalogue | `finishedGoods/catalogue:summary`                      |       272 |   136.9 |       45.59 |            44.32 |        2 |       1.6 |                   |
| hr-admin     | `hr/review:queuePage`                                  |       251 |   139.4 |        79.9 |            90.67 |        2 |       9.9 |                   |
| job-scan     | `finishedGoods/jobScanLocations:options`               |       218 |   134.8 |       26.16 |            27.16 |        1 |      13.2 |                   |
| hr-admin     | `hr/periods:preview`                                   |       164 |   114.0 |       17.39 |            19.76 |        1 |       0.8 |                   |
| hr-admin     | `hr/roster:roster`                                     |       162 |   112.8 |        16.3 |            17.57 |        1 |       0.1 | LIMIT_EXCEEDED    |
| hr-admin     | `hr/setup:employeesPage`                               |       141 |    83.6 |       86.96 |            77.06 |        1 |      15.0 |                   |
| hr-admin     | `hr/search:adminEmployees`                             |       111 |    75.2 |       26.03 |            38.93 |        1 |       1.5 |                   |
| fg-catalogue | `finishedGoods/catalogue:page` (products tab)          |       110 |    55.1 |       23.18 |            25.92 |        1 |      74.0 |                   |
| storage      | `storageLayouts/locationCatalogue:options`             |       109 |    69.1 |       12.16 |            14.07 |        1 |      14.5 |                   |
| storage      | `storageLayouts/locationCatalogue:page`                |        83 |    52.8 |       19.59 |            21.08 |        1 |      25.8 |                   |
| fg-pallet    | `finishedGoods/workflow:getPallet`                     |        75 |    50.9 |       16.88 |            18.66 |        1 |       2.3 |                   |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets tab)           |        65 |    39.2 |       36.94 |            38.82 |        1 |      75.3 |                   |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets search)        |        65 |    39.2 |        34.6 |            37.62 |        1 |      75.3 |                   |
| job-scan     | `finishedGoods/jobScanLocations:buildingOptions`       |        61 |    37.8 |       12.43 |             13.6 |        1 |       7.7 |                   |
| job-scan     | `finishedGoods/jobScans:listJobScans`                  |        60 |    36.9 |       30.25 |            31.97 |        1 |      21.3 |                   |
| job-scan     | `finishedGoods/jobScans:listJobScans` (unmapped)       |        60 |    37.0 |       29.86 |             30.6 |        1 |      21.3 |                   |
| fg-product   | `finishedGoods/batches:pageLegacyUnits`                |        31 |    17.7 |       18.04 |            19.09 |        1 |      15.8 |                   |
| storage      | `storageLayouts/catalogue:listStorageBuildingsPage`    |        29 |    16.2 |       22.89 |            36.57 |        1 |      13.7 |                   |
| hr-admin     | `hr/periods:versionRowsPage`                           |        29 |    16.3 |       11.04 |            12.73 |        1 |       9.4 |                   |
| hr-admin     | `hr/setup:accessMembersPage`                           |        26 |     8.4 |       13.44 |            14.92 |        1 |       0.6 |                   |
| storage      | `storageLayouts/catalogue:getStorageBuildingLayout`    |        25 |    14.3 |       20.34 |            14.47 |        1 |       7.4 |                   |
| storage      | `storageLayouts/writes:layoutReadiness`                |        25 |    14.3 |       15.78 |            23.18 |        1 |       1.9 |                   |
| hr-admin     | `hr/setup:employee`                                    |        19 |     6.2 |        18.5 |            23.14 |        1 |       0.6 |                   |
| ai-usage     | `aiUsage/dimensions:actorOptions`                      |        17 |     5.3 |       53.08 |            53.21 |        1 |       0.4 |                   |
| shell        | `workspace/current:readCurrent`                        |        16 |     5.0 |        8.86 |            10.54 |        1 |       0.5 |                   |
| shell        | `hr/access:display`                                    |        16 |     5.3 |        9.05 |             9.88 |        1 |       0.7 |                   |
| job-scan     | `finishedGoods/jobScanLocations:resolve`               |        15 |     6.2 |       10.89 |            12.49 |        1 |       0.6 |                   |
| hr-self      | `hr/self:today`                                        |        14 |     6.3 |       62.26 |            79.64 |        1 |       0.8 |                   |
| job-scan     | `finishedGoods/scanning:resolveLocationCode`           |        13 |     5.0 |       10.46 |            11.36 |        1 |       0.5 |                   |
| fg-product   | `finishedGoods/catalogue:productSummary`               |        12 |     4.3 |        9.61 |            10.36 |        1 |       0.3 |                   |
| hr-self      | `hr/self:profile`                                      |        12 |     4.1 |       10.69 |            11.22 |        1 |       0.6 |                   |
| hr-self      | `hr/self:history`                                      |        12 |     5.6 |       13.76 |            15.53 |        1 |       1.6 |                   |
| shell        | `aiUsage/reports:access`                               |        11 |     3.4 |         8.5 |             9.41 |        1 |       0.2 |                   |
| fg-product   | `finishedGoods/batches:getBatch`                       |        11 |     3.7 |        9.88 |            11.37 |        1 |       1.0 |                   |
| storage      | `storageLayouts/catalogue:buildingStatusControl`       |        11 |     4.4 |        8.96 |            10.98 |        1 |       0.1 |                   |
| hr-admin     | `hr/leave:queuePage`                                   |        11 |     3.4 |       10.78 |            10.93 |        1 |       0.2 |                   |
| fg-product   | `finishedGoods/workflow:getProduct`                    |        10 |     3.4 |        9.63 |            10.16 |        1 |       0.7 |                   |
| fg-product   | `finishedGoods/batches:pageProductBatches`             |        10 |     3.2 |       10.74 |            10.77 |        1 |       0.1 |                   |
| fg-pallet    | `finishedGoods/history:palletMoveHistory`              |        10 |     3.4 |         8.3 |             10.1 |        1 |       0.1 |                   |
| fg-pallet    | `finishedGoods/workflow:stackChoices`                  |        10 |     3.4 |        8.37 |             9.74 |        1 |       0.1 |                   |
| job-scan     | `finishedGoods/scanning:resolvePackageCode`            |        10 |     3.5 |       23.58 |            21.43 |        1 |       0.1 | NOT_OK            |
| hr-self      | `hr/self:requests`                                     |        10 |     4.3 |       11.59 |            11.14 |        1 |       0.6 |                   |
| hr-admin     | `hr/periods:listPage`                                  |        10 |     3.4 |        9.08 |            10.66 |        1 |       0.5 |                   |
| job-scan     | `finishedGoods/jobScanLocations:page`                  |         9 |     2.9 |        9.54 |            10.62 |        1 |       0.2 |                   |
| hr-self      | `hr/announcements:self`                                |         9 |     3.4 |       19.55 |            17.44 |        1 |       0.1 |                   |
| hr-self      | `hr/notifications:list`                                |         9 |     3.4 |       30.08 |            32.92 |        1 |       0.2 |                   |
| hr-self      | `hr/leave:self`                                        |         9 |     3.4 |       29.09 |            38.87 |        1 |       0.3 |                   |
| hr-admin     | `hr/roster:shifts`                                     |         9 |     2.8 |         9.9 |            10.42 |        1 |       0.2 |                   |
| hr-admin     | `hr/payslips:list`                                     |         9 |     3.4 |        9.66 |             11.2 |        1 |       0.1 | POLICY_NOT_ACTIVE |
| hr-admin     | `hr/payslips:imports`                                  |         8 |     2.7 |        9.09 |            10.04 |        1 |       0.1 | POLICY_NOT_ACTIVE |
| hr-admin     | `hr/org:listDepartments`                               |         8 |     2.7 |        9.07 |            10.88 |        1 |       0.1 |                   |
| ai-usage     | `aiUsage/reports:summary`                              |         8 |     2.7 |       15.66 |            15.14 |        1 |       1.2 |                   |
| ai-usage     | `aiUsage/reports:recent`                               |         8 |     2.7 |       17.44 |            23.27 |        1 |       0.1 |                   |

**candidate: write flows**

| Flow                               | Function                                 | Docs read | Docs written | Index rows | Exec p50 ms |
| ---------------------------------- | ---------------------------------------- | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:saveJobScans`    |        10 |            4 |         22 |       55.16 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:updateJobScan`   |        13 |            4 |         22 |       44.99 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:deleteJobScans`  |        13 |            4 |         22 |        40.1 |
| job-scan save batch of 50 (max)    | `finishedGoods/jobScans:saveJobScans`    |        10 |           53 |        218 |       39.18 |
| pallet measurement save            | `finishedGoods/workflow:saveMeasurement` |        11 |            2 |         14 |       32.33 |

**candidate: reactive fan-out** (63 subscriptions open on one session)

| Write                           | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Re-run functions                                 |
| ------------------------------- | -------------: | -----------: | ---------: | -------------: | ------------------------------------------------ |
| saveJobScans (1 item)           |              3 |          232 |      123.6 |            605 | finishedGoods/jobScans:listJobScans×3 (232 docs) |
| saveMeasurement (stored pallet) |              0 |            0 |        0.0 |              0 |                                                  |

**candidate: contention** 8 concurrent saveJobScans → OCC retries 0, failures 0, RTT p50 1724.1 ms / max 2365.3 ms

**base: write flows**

| Flow                               | Function                                 | Docs read | Docs written | Index rows | Exec p50 ms |
| ---------------------------------- | ---------------------------------------- | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:saveJobScans`    |        10 |            4 |         22 |      253.44 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:updateJobScan`   |        13 |            4 |         22 |      133.74 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:deleteJobScans`  |        13 |            4 |         22 |       61.98 |
| job-scan save batch of 50 (max)    | `finishedGoods/jobScans:saveJobScans`    |        10 |           53 |        218 |      292.16 |
| pallet measurement save            | `finishedGoods/workflow:saveMeasurement` |        11 |            2 |         14 |       44.93 |

**base: reactive fan-out** (63 subscriptions open on one session)

| Write                           | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Re-run functions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | -------------: | -----------: | ---------: | -------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| saveJobScans (1 item)           |              1 |           60 |       31.4 |         1348.4 | finishedGoods/jobScans:listJobScans×1 (60 docs)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| saveMeasurement (stored pallet) |             23 |          889 |      519.4 |        85701.1 | hr/self:history×1 (12 docs); hr/self:requests×1 (10 docs); hr/announcements:self×1 (9 docs); hr/self:today×1 (14 docs); hr/notifications:list×1 (9 docs); hr/leave:self×1 (9 docs); hr/periods:listPage×1 (10 docs); hr/periods:versionRowsPage×1 (29 docs); hr/roster:roster×1 (162 docs); hr/setup:employeesPage×1 (141 docs); hr/periods:preview×1 (164 docs); hr/payslips:list×1 (9 docs); hr/roster:shifts×1 (9 docs); hr/payslips:imports×1 (8 docs); hr/leave:queuePage×1 (11 docs); hr/org:listDepartments×1 (8 docs); hr/setup:employee×1 (19 docs); hr/setup:accessMembersPage×1 (26 docs); hr/search:adminEmployees×1 (111 docs); aiUsage/reports:summary×1 (8 docs); aiUsage/reports:recent×1 (8 docs); aiUsage/dimensions:actorOptions×1 (17 docs); hr/review:queuePage×1 (86 docs) |

**base: contention** 8 concurrent saveJobScans → OCC retries 0, failures 0, RTT p50 3673.1 ms / max 5244.7 ms
