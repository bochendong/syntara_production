#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const learnPagePath = 'components/learn/learn-page-client.tsx';
const learnPage = fs.readFileSync(path.join(root, learnPagePath), 'utf8');

const deferredComponents = [
  {
    binding: 'CourseProblemBankView',
    modulePath: '@/components/problem-bank/course-problem-bank-view',
    exportName: 'CourseProblemBankView',
  },
  {
    binding: 'CourseMaterialsPanel',
    modulePath: '@/components/courses/course-materials-panel',
    exportName: 'CourseMaterialsPanel',
  },
  {
    binding: 'CourseLearningProgressPanel',
    modulePath: '@/components/learn/course-learning-progress-panel',
    exportName: 'CourseLearningProgressPanel',
  },
  {
    binding: 'DeferredCreateCourseDialog',
    modulePath: '@/components/courses/create-course-dialog',
    exportName: 'CreateCourseDialog',
  },
  {
    binding: 'DeferredCourseSettingsDialog',
    modulePath: '@/components/courses/course-settings-dialog',
    exportName: 'CourseSettingsDialog',
  },
  {
    binding: 'DeferredLearnAllSessionsDialog',
    modulePath: '@/components/learn/learn-all-sessions-dialog',
    exportName: 'LearnAllSessionsDialog',
  },
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function staticValueImportPaths(source) {
  const paths = new Set();
  const importDeclaration = /(?:^|\n)import\s+(type\s+)?[\s\S]*?\s+from\s+(['"])([^'"]+)\2\s*;/g;
  for (const match of source.matchAll(importDeclaration)) {
    if (!match[1]) paths.add(match[3]);
  }
  return paths;
}

const staticImports = staticValueImportPaths(learnPage);

assert.match(learnPage, /import dynamic from 'next\/dynamic';/);

for (const component of deferredComponents) {
  assert.equal(
    staticImports.has(component.modulePath),
    false,
    `${component.modulePath} must not be a static value import in ${learnPagePath}`,
  );

  const modulePath = escapeRegExp(component.modulePath);
  const dynamicImportOccurrences =
    learnPage.match(new RegExp(`import\\((['"])${modulePath}\\1\\)`, 'g'))?.length ?? 0;
  assert.equal(
    dynamicImportOccurrences,
    1,
    `${component.modulePath} must have exactly one dynamic import`,
  );

  assert.match(
    learnPage,
    new RegExp(
      `const\\s+${component.binding}\\s*=\\s*dynamic\\([\\s\\S]{0,500}` +
        `import\\((['"])${modulePath}\\1\\)[\\s\\S]{0,220}` +
        `module\\.${component.exportName}[\\s\\S]{0,220}loading:\\s*\\(\\)\\s*=>`,
    ),
    `${component.exportName} must use next/dynamic with a loading fallback`,
  );
}

assert.match(
  learnPage,
  /import type \{ CourseProblemPracticeHeaderState \} from '@\/components\/problem-bank\/course-problem-bank-view';/,
  'CourseProblemPracticeHeaderState must remain a type-only import',
);

for (const [wrapper, chunk] of [
  ['CreateCourseDialog', 'DeferredCreateCourseDialog'],
  ['CourseSettingsDialog', 'DeferredCourseSettingsDialog'],
  ['LearnAllSessionsDialog', 'DeferredLearnAllSessionsDialog'],
]) {
  assert.match(
    learnPage,
    new RegExp(
      `function\\s+${wrapper}\\([\\s\\S]{0,180}if\\s*\\(!props\\.open\\)\\s*return null;` +
        `[\\s\\S]{0,140}<${chunk}\\s+\\{\\.\\.\\.props\\}\\s*\\/>`,
    ),
    `${wrapper} must not request its deferred chunk while closed`,
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: deferredComponents.map(
        (component) => `${component.exportName} is dynamically imported`,
      ),
      guardedClosedDialogs: [
        'CreateCourseDialog',
        'CourseSettingsDialog',
        'LearnAllSessionsDialog',
      ],
    },
    null,
    2,
  )}\n`,
);
