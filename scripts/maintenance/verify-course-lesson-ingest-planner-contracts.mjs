#!/usr/bin/env node

import fs from 'node:fs';

const plannerPath = 'scripts/maintenance/plan-course-lesson-ingest-via-api.mjs';
const planner = fs.readFileSync(plannerPath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /mode:\s*'read_only_plan'[\s\S]*?lessonCount:\s*1/.test(planner),
  'planner must emit a one-lesson read-only plan',
);
assert(
  /applicationWrites:\s*0[\s\S]*?generationCalls:\s*0[\s\S]*?maximumLessonsPerFutureRun:\s*1/.test(
    planner,
  ),
  'planner must publish its zero-write and one-lesson safety boundary',
);
assert(
  /rawSha256:\s*sourceHash[\s\S]*?problemIdDigest:\s*exactIdDigest\(problemIds\)/.test(planner),
  'planner must lock the source hash and exact problem-ID baseline',
);
assert(
  /source-uploads\?includeText=0&includeArtifacts=0[\s\S]*?content-state[\s\S]*?problems\?summary=1/.test(
    planner,
  ) ||
    /content-state[\s\S]*?source-uploads\?includeText=0&includeArtifacts=0[\s\S]*?problems\?summary=1/.test(
      planner,
    ),
  'planner must read source, content-state, and problem APIs',
);
assert(
  !/\bmethod\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/.test(planner),
  'planner must not contain a mutating HTTP method',
);
assert(!/FormData|--execute/.test(planner), 'planner must not expose an upload/execute path');

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      planner: plannerPath,
      contracts: [
        'GET-only API state',
        'exactly one lesson',
        'source SHA256 lock',
        'exact problem-ID baseline',
        'zero application writes',
        'zero generation calls',
      ],
    },
    null,
    2,
  )}\n`,
);
