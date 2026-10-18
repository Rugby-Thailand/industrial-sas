## Pass recall
| variant | size | n | locHit | locN | locFirstWrong | locExtraIdentity | jobHit | jobN | foHit | fomHit | qrYield | productYield | ticketBoth | firstQrNonJob | firstFomAsProduct | firstOtherFormat | multiIdentityFrames | negativeReads | errors | timeouts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jsDefault | 1920 | 153 | 0 | 58 | 1 | 1 | 40 | 92 | 33/80 | 7/12 | 30 | 1 | 0 | 0 | 7 | 0 | 0 | 0/2 | 0 | 0 |
| jsHinted | 1920 | 153 | 0 | 58 | 0 | 0 | 40 | 92 | 33/80 | 7/12 | 30 | 1 | 0 | 0 | 7 | 0 | 0 | 0/2 | 0 | 0 |
| liveFallback | 1920 | 153 | 23 | 58 | 3 | 4 | 81 | 92 | 70/80 | 11/12 | 20 | 48 | 46 | 0 | 4 | 0 | 47 | 0/2 | 0 | 0 |
| native | 1920 | 153 | 33 | 58 | 0 | 0 | 90 | 92 | 78/80 | 12/12 | 80 | 66 | 66 | 0 | 7 | 0 | 66 | 0/2 | 0 | 0 |
| wasmRoiFast | 1920 | 153 | 0 | 58 | 0 | 0 | 0 | 92 | 0/80 | 0/12 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0/2 | 0 | 0 |
| wasmRegions | 1920 | 153 | 14 | 58 | 0 | 0 | 58 | 92 | 49/80 | 9/12 | 0 | 50 | 43 | 0 | 3 | 0 | 43 | 0/2 | 0 | 0 |
| wasmFast | 1920 | 153 | 2 | 58 | 0 | 0 | 70 | 92 | 62/80 | 8/12 | 68 | 8 | 8 | 0 | 8 | 0 | 8 | 0/2 | 0 | 0 |
| wasmHard | 1920 | 153 | 12 | 58 | 0 | 0 | 82 | 92 | 72/80 | 10/12 | 72 | 36 | 33 | 0 | 9 | 0 | 33 | 0/2 | 0 | 0 |
| jsDefault | 1080 | 153 | 0 | 58 | 1 | 1 | 32 | 92 | 26/80 | 6/12 | 25 | 0 | 0 | 0 | 6 | 1 | 0 | 0/2 | 0 | 0 |
| jsHinted | 1080 | 153 | 0 | 58 | 0 | 0 | 32 | 92 | 26/80 | 6/12 | 25 | 0 | 0 | 0 | 6 | 0 | 0 | 0/2 | 0 | 0 |
| liveFallback | 1080 | 153 | 6 | 58 | 3 | 3 | 79 | 92 | 68/80 | 11/12 | 17 | 14 | 14 | 0 | 8 | 0 | 14 | 0/2 | 0 | 0 |
| native | 1080 | 153 | 23 | 58 | 0 | 0 | 89 | 92 | 78/80 | 11/12 | 78 | 44 | 44 | 0 | 6 | 0 | 44 | 0/2 | 0 | 0 |
| wasmRoiFast | 1080 | 153 | 0 | 58 | 0 | 0 | 0 | 92 | 0/80 | 0/12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/2 | 0 | 0 |
| wasmRegions | 1080 | 153 | 2 | 58 | 0 | 0 | 58 | 92 | 49/80 | 9/12 | 0 | 6 | 5 | 0 | 8 | 0 | 6 | 0/2 | 0 | 0 |
| wasmFast | 1080 | 153 | 0 | 58 | 0 | 0 | 57 | 92 | 49/80 | 8/12 | 56 | 0 | 0 | 0 | 8 | 0 | 0 | 0/2 | 0 | 0 |
| wasmHard | 1080 | 153 | 1 | 58 | 0 | 0 | 73 | 92 | 64/80 | 9/12 | 61 | 6 | 4 | 0 | 9 | 0 | 4 | 0/2 | 0 | 0 |

## Pass timing
| variant | size | wallP50 | wallP95 | wallMax | noRead | noReadP50 | noReadP95 | mainBlockP95 | mainBlockMax | grabP50 | postP50 | workerPixelsP50 | workerDecodeP50 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jsDefault | 1920 | 52 | 106.9 | 115.2 | 111 | 54.9 | 109.2 | 106.9 | 115.2 |  |  |  |  |
| jsHinted | 1920 | 25.5 | 81.2 | 86.1 | 112 | 27.5 | 81.2 | 81.2 | 86.1 |  |  |  |  |
| liveFallback | 1920 | 651.8 | 1230.7 | 1415.9 | 44 | 203.6 | 1201.7 | 165 | 432 |  |  |  |  |
| native | 1920 | 23.9 | 32.3 | 49 | 30 | 22.2 | 29.4 | 0 | 84 |  |  |  |  |
| wasmRoiFast | 1920 | 6.5 | 16.9 | 17.4 | 152 | 6.5 | 16.9 | 52 | 81 | 0 | 1.1 | 1.5 | 3.5 |
| wasmRegions | 1920 | 68 | 112.8 | 195.9 | 74 | 28.2 | 99.8 | 81 | 81 | 0 | 1.3 | 17.6 | 22.3 |
| wasmFast | 1920 | 21.3 | 73.4 | 75 | 81 | 21.2 | 72.5 | 0 | 81 | 0 | 1.1 | 5.8 | 13.8 |
| wasmHard | 1920 | 37.1 | 89.7 | 91.4 | 56 | 38.1 | 90.9 | 0 | 79 | 0 | 1.2 | 5.5 | 29.5 |
| jsDefault | 1080 | 28.2 | 45.5 | 48.7 | 119 | 29.2 | 45.8 | 45.5 | 48.7 |  |  |  |  |
| jsHinted | 1080 | 10.8 | 26.5 | 28.3 | 121 | 11 | 26.6 | 26.5 | 28.3 |  |  |  |  |
| liveFallback | 1080 | 552.3 | 1072.8 | 1222.2 | 65 | 206.1 | 823.9 | 149 | 276 |  |  |  |  |
| native | 1080 | 19.4 | 26.6 | 66.8 | 41 | 16.8 | 20.5 | 0 | 0 |  |  |  |  |
| wasmRoiFast | 1080 | 2.3 | 5.4 | 7.4 | 153 | 2.3 | 5.4 | 0 | 0 | 0 | 0.4 | 0.5 | 1.3 |
| wasmRegions | 1080 | 27.2 | 60.7 | 91.8 | 92 | 16.2 | 52.2 | 0 | 0 | 0 | 0.5 | 5.8 | 18.1 |
| wasmFast | 1080 | 7.7 | 23.6 | 25.1 | 96 | 7.7 | 23.8 | 0 | 0 | 0 | 0.4 | 2 | 4.9 |
| wasmHard | 1080 | 15.6 | 30.4 | 31.8 | 77 | 15.6 | 30.4 | 0 | 0 | 0 | 0.4 | 1.8 | 12.7 |

## Derived cascade
| variant | size | n | locHit | locN | locFirstWrong | locExtraIdentity | jobHit | jobN | foHit | fomHit | qrYield | productYield | wallP50 | wallP95 | escalated |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fast>hard | 1920 | 153 | 12 | 58 | 0 | 0 | 82 | 92 | 72/80 | 10/12 | 72 | 36 | 58.6 | 161.7 | 143 |
| fast>hard | 1080 | 153 | 1 | 58 | 0 | 0 | 73 | 92 | 64/80 | 9/12 | 61 | 6 | 23.4 | 54 | 153 |
| fast>regions>hard | 1920 | 153 | 14 | 58 | 0 | 0 | 86 | 92 | 75/80 | 11/12 | 71 | 52 | 99.7 | 241.4 | 143 |
| fast>regions>hard | 1080 | 153 | 2 | 58 | 0 | 0 | 77 | 92 | 68/80 | 9/12 | 59 | 7 | 57.7 | 110.3 | 153 |
| native>regions | 1920 | 153 | 33 | 58 | 0 | 0 | 90 | 92 | 78/80 | 12/12 | 13 | 66 | 27.5 | 116.4 | 54 |
| native>regions | 1080 | 153 | 23 | 58 | 0 | 0 | 89 | 92 | 78/80 | 11/12 | 16 | 44 | 24.6 | 78.7 | 86 |

## ROI loss
{"1080":{"frames":153,"framesLosing":57,"lostIdentities":57,"lostExpected":57,"roiOnly":0},"1920":{"frames":153,"framesLosing":72,"lostIdentities":79,"lostExpected":72,"roiOnly":0}}
## Controls
[{"variant":"jsDefault","id":"blank","symbols":[],"wallMs":50},{"variant":"jsHinted","id":"blank","symbols":[],"wallMs":20},{"variant":"liveFallback","id":"blank","symbols":[],"wallMs":98},{"variant":"wasmFast","id":"blank","symbols":[],"wallMs":21},{"variant":"wasmHard","id":"blank","symbols":[],"wallMs":33},{"variant":"wasmRoiFast","id":"blank","symbols":[],"wallMs":6},{"variant":"native","id":"blank","symbols":[],"wallMs":24},{"variant":"jsDefault","id":"noise","symbols":[],"wallMs":133},{"variant":"jsHinted","id":"noise","symbols":[],"wallMs":67},{"variant":"liveFallback","id":"noise","symbols":[],"wallMs":235},{"variant":"wasmFast","id":"noise","symbols":[],"wallMs":27},{"variant":"wasmHard","id":"noise","symbols":[],"wallMs":63},{"variant":"wasmRoiFast","id":"noise","symbols":[],"wallMs":11},{"variant":"native","id":"noise","symbols":[],"wallMs":16},{"variant":"wasmRegions","id":"blank","symbols":[],"wallMs":17},{"variant":"wasmRegions","id":"noise","symbols":[],"wallMs":38}]
## Repeat timing
| variant | size | wallP50 | wallP95 | wallMax | noRead | noReadP50 | noReadP95 | mainBlockP95 | mainBlockMax | grabP50 | postP50 | workerPixelsP50 | workerDecodeP50 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jsDefault | 1920 | 47.3 | 94.7 | 96.5 | 95 | 50.1 | 95.3 | 94.7 | 96.5 |  |  |  |  |
| jsHinted | 1920 | 26.9 | 77.7 | 82.1 | 135 | 27.7 | 78.4 | 77.7 | 82.1 |  |  |  |  |
| liveFallback | 1920 | 611.4 | 1227.5 | 1261.7 | 75 | 377.1 | 1207 | 181 | 208 |  |  |  |  |
| native | 1920 | 23.5 | 31.9 | 37.1 | 60 | 21.5 | 34.3 | 0 | 79 |  |  |  |  |
| wasmRoiFast | 1920 | 7.1 | 16.9 | 17.5 | 175 | 7.1 | 16.9 | 0 | 79 | 0 | 1.1 | 1.6 | 3.6 |
| wasmFast | 1920 | 21.9 | 73 | 74.2 | 125 | 22.1 | 72.9 | 0 | 79 | 0 | 1.2 | 5.9 | 13.8 |
| wasmHard | 1920 | 40.1 | 89.4 | 92 | 105 | 40.2 | 88.5 | 0 | 79 | 0 | 1.1 | 5.8 | 30.1 |
| jsDefault | 1080 | 25.1 | 39.2 | 43.9 | 100 | 27.7 | 40.8 | 39.2 | 43.9 |  |  |  |  |
| jsHinted | 1080 | 11.3 | 25.8 | 29.2 | 145 | 11.3 | 26.3 | 25.8 | 29.2 |  |  |  |  |
| liveFallback | 1080 | 440 | 1021.5 | 1238.4 | 105 | 304.1 | 826.2 | 120 | 150 |  |  |  |  |
| native | 1080 | 19.6 | 26.2 | 28.7 | 80 | 18.8 | 22.7 | 0 | 0 |  |  |  |  |
| wasmRoiFast | 1080 | 2.5 | 5.5 | 5.9 | 175 | 2.5 | 5.5 | 0 | 0 | 0 | 0.4 | 0.5 | 1.3 |
| wasmFast | 1080 | 8 | 24 | 24.7 | 135 | 8 | 23.8 | 0 | 0 | 0 | 0.4 | 2.1 | 5 |
| wasmHard | 1080 | 16.7 | 30.9 | 32.2 | 120 | 16.8 | 30.3 | 0 | 0 | 0 | 0.4 | 1.9 | 13 |

## Repeat (regions run)
| variant | size | wallP50 | wallP95 | wallMax | noRead | noReadP50 | noReadP95 | mainBlockP95 | mainBlockMax | grabP50 | postP50 | workerPixelsP50 | workerDecodeP50 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| wasmRegions | 1920 | 43.4 | 119.4 | 135.4 | 105 | 29.7 | 94.3 | 50 | 81 | 0 | 1.2 | 17.5 | 16.5 |
| wasmFast | 1920 | 21.8 | 72.7 | 75.5 | 125 | 22.3 | 72.8 | 50 | 81 | 0 | 1.2 | 5.7 | 13.8 |
| wasmRegions | 1080 | 23.8 | 61.8 | 68.7 | 135 | 14.8 | 48.3 | 0 | 0 | 0 | 0.4 | 6 | 8.5 |
| wasmFast | 1080 | 7.8 | 23.1 | 23.9 | 135 | 8 | 23.2 | 0 | 0 | 0 | 0.4 | 2 | 4.9 |

## Stability (regions run)
| variant | size | images | reps | medianOfMediansMs | p95OfMediansMs | medianRelSpread |
| --- | --- | --- | --- | --- | --- | --- |
| wasmRegions | 1920 | 35 | 5 | 43.4 | 119.5 | 0 |
| wasmFast | 1920 | 35 | 5 | 21.8 | 72.4 | 0 |
| wasmRegions | 1080 | 35 | 5 | 23.8 | 62.1 | 0 |
| wasmFast | 1080 | 35 | 5 | 7.7 | 23.1 | 0.1 |

## Diagnose
[[15,1920,[{"text":"FP-L27-1q","format":"CODE_128"}]],[22,1920,[{"text":"22-L28U1/","format":"CODE_128"}]],[25,1920,[{"text":"22-LF8-'8","format":"CODE_128"}]],[4,1080,[{"text":"FO-!3!/1","format":"CODE_128"}]],[10,1080,[{"text":"F\",%(7\"1!","format":"CODE_128"}]],[24,1080,[{"text":"12 %28,1\"","format":"CODE_128"}]]]
## Stability
| variant | size | images | reps | medianOfMediansMs | p95OfMediansMs | medianRelSpread |
| --- | --- | --- | --- | --- | --- | --- |
| jsDefault | 1920 | 35 | 5 | 47.3 | 94.7 | 0 |
| jsHinted | 1920 | 35 | 5 | 26.7 | 77 | 0 |
| liveFallback | 1920 | 35 | 5 | 611.4 | 1227.6 | 0 |
| wasmFast | 1920 | 35 | 5 | 21.9 | 72.9 | 0 |
| wasmHard | 1920 | 35 | 5 | 39.9 | 88.2 | 0 |
| wasmRoiFast | 1920 | 35 | 5 | 7.1 | 16.8 | 0 |
| native | 1920 | 35 | 5 | 23 | 31.2 | 0.3 |
| jsDefault | 1080 | 35 | 5 | 25.1 | 39.2 | 0 |
| jsHinted | 1080 | 35 | 5 | 11.3 | 25.7 | 0.1 |
| liveFallback | 1080 | 35 | 5 | 440 | 1027.9 | 0 |
| wasmFast | 1080 | 35 | 5 | 8 | 24 | 0.1 |
| wasmHard | 1080 | 35 | 5 | 16.8 | 30.6 | 0.1 |
| wasmRoiFast | 1080 | 35 | 5 | 2.5 | 5.5 | 0.1 |
| native | 1080 | 35 | 5 | 19.8 | 25.8 | 0.3 |

## Live
{
  "current": {
    "images": 35,
    "locHit": "5/16",
    "jobHit": "10/16",
    "ticketProductCandidate": "0/16",
    "hitMsP50": 189,
    "hitMsP95": 1829,
    "firstWrong": 1,
    "locationImagesWithWrongDelivery": [
      "25:22-LF8-'8@fallback|22-LF8-'8@fallback|22-LF8-'8@fallback"
    ],
    "firstFomAsProduct": 5,
    "negativeDelivered": 0,
    "attemptsP50": 25,
    "fallbacksP50": 3,
    "fallbackMaxMs": 1598,
    "rafMaxGapP50": 76.5,
    "rafMaxGapP95": 166.6,
    "rafMaxGapMax": 224.9,
    "longTaskMaxP95": 171,
    "longTaskSumP50": 1666,
    "stopMsMax": 2.1,
    "droppedAfterStop": 0,
    "hitVia": {
      "fallback": 7,
      "js": 8
    }
  },
  "current-run2": {
    "images": 35,
    "locHit": "5/16",
    "jobHit": "10/16",
    "ticketProductCandidate": "0/16",
    "hitMsP50": 188,
    "hitMsP95": 1621,
    "firstWrong": 1,
    "locationImagesWithWrongDelivery": [
      "25:22-LF8-'8@fallback|22-LF8-'8@fallback|22-LF8-'8@fallback"
    ],
    "firstFomAsProduct": 5,
    "negativeDelivered": 0,
    "attemptsP50": 25,
    "fallbacksP50": 3,
    "fallbackMaxMs": 1461,
    "rafMaxGapP50": 83.4,
    "rafMaxGapP95": 165.7,
    "rafMaxGapMax": 241.7,
    "longTaskMaxP95": 170,
    "longTaskSumP50": 1652,
    "stopMsMax": 0.5,
    "droppedAfterStop": 0,
    "hitVia": {
      "fallback": 7,
      "js": 8
    }
  },
  "proposed": {
    "images": 35,
    "locHit": "1/16",
    "jobHit": "13/16",
    "ticketProductCandidate": "1/16",
    "hitMsP50": 47,
    "hitMsP95": 679,
    "firstWrong": 0,
    "locationImagesWithWrongDelivery": [],
    "firstFomAsProduct": 5,
    "negativeDelivered": 0,
    "attemptsP50": 247,
    "fallbacksP50": 0,
    "fallbackMaxMs": 0,
    "rafMaxGapP50": 10.7,
    "rafMaxGapP95": 66.7,
    "rafMaxGapMax": 83.3,
    "longTaskMaxP95": 84,
    "longTaskSumP50": 0,
    "stopMsMax": 69.5,
    "droppedAfterStop": 6,
    "hitVia": {
      "hard": 4,
      "fast": 10
    }
  },
  "proposed-run2": {
    "images": 35,
    "locHit": "1/16",
    "jobHit": "13/16",
    "ticketProductCandidate": "1/16",
    "hitMsP50": 52,
    "hitMsP95": 681,
    "firstWrong": 0,
    "locationImagesWithWrongDelivery": [],
    "firstFomAsProduct": 5,
    "negativeDelivered": 0,
    "attemptsP50": 244,
    "fallbacksP50": 0,
    "fallbackMaxMs": 0,
    "rafMaxGapP50": 16.6,
    "rafMaxGapP95": 66.7,
    "rafMaxGapMax": 66.8,
    "longTaskMaxP95": 59,
    "longTaskSumP50": 0,
    "stopMsMax": 40.4,
    "droppedAfterStop": 8,
    "hitVia": {
      "hard": 4,
      "fast": 10
    }
  },
  "proposedV2": {
    "images": 35,
    "locHit": "3/16",
    "jobHit": "13/16",
    "ticketProductCandidate": "10/16",
    "hitMsP50": 64,
    "hitMsP95": 410,
    "firstWrong": 0,
    "locationImagesWithWrongDelivery": [],
    "firstFomAsProduct": 5,
    "negativeDelivered": 0,
    "attemptsP50": 188,
    "fallbacksP50": 0,
    "fallbackMaxMs": 0,
    "rafMaxGapP50": 9.4,
    "rafMaxGapP95": 92.2,
    "rafMaxGapMax": 117.7,
    "longTaskMaxP95": 87,
    "longTaskSumP50": 0,
    "stopMsMax": 57.5,
    "droppedAfterStop": 6,
    "hitVia": {
      "regions": 5,
      "fast": 10,
      "hard": 1
    }
  }
}
## Formats
{"native:code_128":316,"wasmHard:Code128":168,"wasmFast:Code128":34,"jsDefault:MICRO_QR_CODE":2,"wasmFast:QRCode":124,"wasmHard:QRCode":133,"native:qr_code":158,"jsHinted:CODE_128":18,"jsDefault:CODE_128":18,"jsDefault:QR_CODE":55,"jsHinted:QR_CODE":55,"wasmRoiFast:Code128":1,"jsDefault:EAN_8":1,"wasmRegions:Code128":189}
QR payloads: 67 ["40347","000416","FO69100219","FO69090412","FO69100151"]
