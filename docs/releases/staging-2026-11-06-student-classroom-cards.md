# 学生课堂卡片与商城页头发布

已核对实际部署版本、认证只读接口、线上页面及资源哈希。以下为不含凭据的发布凭证。

```json
{
  "at": "2026-11-06T19:24:53.961Z",
  "status": "deployed",
  "branch": "codex/staging-next",
  "baselineBranch": "codex/staging-baseline",
  "revision": "90521eaf9072e79ed968852080f2438a8c500506",
  "previousRevision": "786801a7ab8ef9f3bf9b1dc91f95b1403630c4a7",
  "deploymentId": "fe29910f-0180-4773-b32e-02add9b049bf",
  "origin": "https://native-api-staging-staging-95a1.up.railway.app",
  "pullRequest": "https://github.com/bochendong/syntara_production/pull/53",
  "changes": [
    "Student Classroom starts with scene-cover course cards from the account course list and accessible session courses. Cards preserve campus-qualified course names and show current and past session counts.",
    "The entire course card opens that course session list; joining and viewing historical sessions preserve the course navigation level. Code entry is expandable; existing join APIs are retained.",
    "Student result marbles and labels now use formal submission counts: green first pass, purple multiple submissions before passing.",
    "Store header retains the shared 52px back-button space at desktop widths, removing the conflicting zero-padding override."
  ],
  "verification": {
    "localChecks": {
      "formatLintRootNativeViteTypes": "PASS",
      "nativeWebBuild": "PASS"
    },
    "railwayProductionBuild": true,
    "releaseNativeBuild": true,
    "localBrowser": {
      "fullAppReadOnlyStagingData": {
        "courses": 5,
        "wholeCardNavigation": true,
        "emptyCourseState": true,
        "campusQualifiedNames": true,
        "viewportWidth": 897,
        "documentScrollWidth": 897
      },
      "storeHeader": {
        "viewportWidth": 1135,
        "backRight": 110,
        "titleLeft": 120,
        "gap": 10,
        "searchRight": 1119
      },
      "explicitMockFixture": {
        "liveCourseCounts": [
          1,
          1
        ],
        "joinSession": true,
        "pastSession": true,
        "returnToSelectedCourse": true,
        "courseIsolation": true,
        "codeJoinCrossCourse": true,
        "retryLabel": "多次做对 · 2 次",
        "retryMarble": "r-purple-swirl.webp"
      },
      "screenshots": [
        "student-cards.jpg",
        "store-header.jpg"
      ]
    },
    "liveApi": {
      "at": "2026-11-06T19:23:41.474Z",
      "coursesStatus": 200,
      "classroomStatus": 200,
      "courseCount": 5,
      "courseNames": [
        "UTSG-CSC108Y",
        "UTM-CSC108",
        "UBC-CPSC103",
        "UTM-MAT102",
        "UTSC-CSCA67"
      ],
      "liveCount": 0,
      "pastCount": 0,
      "mutationPerformed": false
    },
    "liveBrowser": {
      "at": "2026-11-06T19:24:53.937324+00:00",
      "courseCards": true,
      "courseCount": 5,
      "courseEntry": true,
      "emptyCourseState": true,
      "storeHeaderClear": true,
      "storeHeader": {
        "width": 1512,
        "backRight": 110,
        "titleLeft": 274,
        "gap": 164
      },
      "source": "Actual authenticated staging App in Chrome",
      "screenshot": "artifacts/student-classroom-release/student-cards-online.jpg",
      "realClassroomJoinPerformed": false,
      "studentSubmissionPerformed": false
    },
    "health": true,
    "appStatus": 200,
    "assetCount": 42,
    "imageAssetsMatched": 40,
    "entryAssets": [
      {
        "path": "/native-web/assets/index-DftX6x1U.css",
        "status": 200,
        "type": "text/css; charset=UTF-8",
        "bytes": 524026,
        "sha256": "34db78228d487571d0afd9bedd0b8e65c71e0d47d6626f6e09996e4128c4f25c",
        "matched": true
      },
      {
        "path": "/native-web/assets/index-eAL0UfG5.js",
        "status": 200,
        "type": "application/javascript; charset=UTF-8",
        "bytes": 2216675,
        "sha256": "3a8dd196586099f2301626316ef0946aedcba22f8cabab2979884ce2c8b66a44",
        "matched": true
      }
    ],
    "screenshots": [
      "docs/releases/staging-2026-11-06-student-cards.jpg",
      "docs/releases/staging-2026-11-06-store-header.jpg"
    ],
    "limitations": [
      "Active, historical and cross-course code joins verified with explicitly labeled disposable local fixtures; no real student classroom joins, submissions or deletions during this release verification.",
      "No mobile narrow-screen verification; desktop 1135px and local 897px checked.",
      "CI does not target staging-next. Local format/lint/types, native production build and Railway production build passed; existing large-chunk and framework/PDF warnings remain."
    ]
  },
  "migrations": [],
  "nativeInstallersRebuilt": false,
  "realDataMutationPerformed": false
}
```
